export class CDP {
  constructor(versionUrl) {
    this.versionUrl = versionUrl;
    this.socket = null;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    const response = await fetch(`${this.versionUrl}/json/version`);
    if (!response.ok) throw new Error(`Chrome DevTools discovery failed (${response.status})`);
    const version = await response.json();
    const socketUrl = new URL(version.webSocketDebuggerUrl);
    socketUrl.hostname = new URL(this.versionUrl).hostname;
    this.socket = new WebSocket(socketUrl.toString());
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else {
        this.events.push(message);
      }
    });
    return this;
  }

  call(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async waitForTarget(predicate) {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const targets = await this.call('Target.getTargets');
      const match = targets.targetInfos.find(predicate);
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error('Chrome page target did not appear.');
  }

  async attach(targetId) {
    const { sessionId } = await this.call('Target.attachToTarget', { targetId, flatten: true });
    return new CDPSession(this, sessionId);
  }

  close() {
    this.socket?.close();
  }
}

class CDPSession {
  constructor(client, sessionId) {
    this.client = client;
    this.sessionId = sessionId;
  }

  call(method, params = {}) {
    const id = ++this.client.nextId;
    return new Promise((resolve, reject) => {
      this.client.pending.set(id, { resolve, reject });
      this.client.socket.send(JSON.stringify({ id, method, params, sessionId: this.sessionId }));
    });
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  }
}
