'use strict';

const APP = {
  baseURL: 'https://api.themoviedb.org/3/',
  IMG_BASE_URL: 'https://image.tmdb.org/t/p/',

  init: () => {
    history.replaceState(null, '', '#');
    window.addEventListener('popstate', NAV.popHistory);
    let searchBtn = document.getElementById('btnSearch');
    searchBtn.addEventListener('click', SEARCH.getInput);
    document.getElementById('shuffleMovies').addEventListener('click', DISCOVER.shuffle);
    DISCOVER.load();

    if (
      window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      document.addEventListener('pointermove', (event) => {
        document.body.style.setProperty('--pointer-x', `${event.clientX}px`);
        document.body.style.setProperty('--pointer-y', `${event.clientY}px`);
      });
    }

  },
};

const DISCOVER = {
  movies: [],

  load: () => {
    const status = document.getElementById('discoverStatus');
    const page = Math.floor(Math.random() * 500) + 1;
    const url = `/api/tmdb?path=discover%2Fmovie&language=en-US&sort_by=popularity.desc&page=${page}`;

    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load movies (${response.status}).`);
        return response.json();
      })
      .then((data) => {
        DISCOVER.movies = data.results || [];
        if (!DISCOVER.movies.length) {
          status.textContent = 'No movies found right now. Try again in a moment.';
          return;
        }
        DISCOVER.shuffle();
      })
      .catch(() => {
        status.textContent = 'Movie picks could not load. Please try again.';
      });
  },

  shuffle: () => {
    if (!DISCOVER.movies.length) {
      DISCOVER.load();
      return;
    }

    const movies = DISCOVER.movies.slice();
    for (let index = movies.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [movies[index], movies[randomIndex]] = [movies[randomIndex], movies[index]];
    }

    const container = document.getElementById('discoverMovies');
    const fragment = document.createDocumentFragment();
    movies.slice(0, 8).forEach((movie) => {
      const col = document.createElement('div');
      col.className = 'col';

      const card = document.createElement('article');
      card.className = 'card';

      if (movie.poster_path) {
        const poster = document.createElement('img');
        poster.src = `${APP.IMG_BASE_URL}w500${movie.poster_path}`;
        poster.alt = `Poster for ${movie.title}`;
        poster.loading = 'lazy';
        card.appendChild(poster);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'discover-poster-placeholder';
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.textContent = '✦';
        card.appendChild(placeholder);
      }

      const body = document.createElement('div');
      body.className = 'card-body';
      const title = document.createElement('h3');
      title.className = 'card-title';
      title.textContent = movie.title || 'Untitled movie';
      const details = document.createElement('p');
      details.className = 'card-text';
      const year = movie.release_date ? movie.release_date.slice(0, 4) : 'Release date unknown';
      const rating = Number.isFinite(movie.vote_average) ? ` · ★ ${movie.vote_average.toFixed(1)}` : '';
      details.textContent = `${year}${rating}`;
      body.append(title, details);
      card.appendChild(body);
      col.appendChild(card);
      fragment.appendChild(col);
    });

    container.replaceChildren(fragment);
    document.getElementById('discoverStatus').textContent = 'A fresh mix of popular movies, shuffled just for you.';
  },
};

const SEARCH = {
  results: [],
  input: '',

  getInput: (ev) => {
    ev.preventDefault();
    location.hash = '';
    SEARCH.input = document.getElementById('search').value;
    // location.hash = SEARCH.input;
    history.pushState({}, SEARCH.input, `#${SEARCH.input}`);

    let input = location.hash;
    SEARCH.doSearch(input);
  },

  doSearch: (input) => {
    let key = STORAGE.Base_KEY + SEARCH.input;
    // SEARCH.doFetch();

    if (key in localStorage) {
      ACTORS.actors = localStorage.getItem(key);
      ACTORS.displayActors(JSON.parse(ACTORS.actors));
      // console.log(ACTORS.actors);
    } else {
      SEARCH.doFetch();
    }
  },

  doFetch() {
    let url = `/api/tmdb?path=search%2Fperson&query=${encodeURIComponent(SEARCH.input)}&language=en-US`;

    fetch(url)
      .then((response) => {
        if (response.ok) {
          return response.json();
        } else {
          throw new Error(
            `ERROR: ${response.status_code} ${response.status_message}`
          );
        }
      })
      .then((data) => {
        SEARCH.results = data.results;
        STORAGE.setStorages(SEARCH.input, data.results);
        ACTORS.displayActors(data.results);
      })
      .catch((error) => {
        alert(error.message);
      });
  },
};

const STORAGE = {
  Base_KEY: '',

  setStorages: (input, results) => {
    let key = STORAGE.Base_KEY + input;
    localStorage.setItem(key, JSON.stringify(results));
    console.log(JSON.stringify(results));
  },
};

const ACTORS = {
  actors: [],

  displayActors: (actors) => {
    console.log(actors);
    let actorsPage = document.getElementById('actors');
    let mediaPage = document.getElementById('media');
    let discoverPage = document.getElementById('discover');

    actorsPage.style.cssText = `
    animation: glass-enter 600ms cubic-bezier(0.2, 0.75, 0.25, 1) both;
   `;
    discoverPage.style.display = 'none';
    actorsPage.style.display = 'flex';
    mediaPage.style.display = 'none';

    let cards = document.getElementById('actorCards');
    cards.innerHTML = '';

    let df = document.createDocumentFragment();

    actors.forEach((actor) => {
      let col = document.createElement('div');
      let card = document.createElement('div');
      let cardBody = document.createElement('div');
      let actorImg = document.createElement('img');
      let actorName = document.createElement('h5');
      let actorPop = document.createElement('p');
      let actKnown = document.createElement('p');

      col.className = 'col mb-0';
      card.className = 'card';
      cardBody.className = 'card-body';
      actorName.className = 'card-title';
      actorPop.className = 'card-text';
      actKnown.className = 'card-text act-known';

      if (actor.profile_path)
        actorImg.src = APP.IMG_BASE_URL + 'w500' + actor.profile_path;
      else actorImg.src = 'https://via.placeholder.com/150x226';

      // actorImg.style.maxHeight = '80%';
      actorImg.alt = actor.name;

      card.setAttribute('data-id', actor.id);
      actorName.textContent = actor.name;
      actorPop.textContent = `Popularity: ${actor.popularity}`;
      actKnown.textContent = `Known for: ${actor.known_for_department}`;

      col.append(card);
      card.append(actorImg, cardBody);
      cardBody.append(actorName, actKnown, actorPop);

      df.appendChild(col);

      let srtName = document.getElementById('srtName');
      srtName.addEventListener('click', SORT.sortName);

      let srtPop = document.getElementById('srtPop');
      srtPop.addEventListener('click', SORT.sortPopularity);

      card.addEventListener('click', MEDIA.setHistory);
    });
    cards.append(df);
  },
};

const SORT = {
  sortName: (ev) => {
    ev.preventDefault();

    let key = STORAGE.Base_KEY + SEARCH.input;
    console.log(key);

    let actorCards = JSON.parse(localStorage.getItem(key));

    let srtName = document.getElementById('srtName');
    srtName.classList.toggle('sort');

    actorCards.sort((a, b) => {
      if (srtName.classList.contains('sort')) {
        srtName.classList.add('asc');
        srtName.classList.remove('des');

        if (a.name > b.name) {
          return 1;
        } else {
          return -1;
        }
      } else {
        srtName.classList.remove('asc');
        srtName.classList.add('des');

        if (a.name < b.name) {
          return 1;
        } else {
          return -1;
        }
      }
    });

    ACTORS.displayActors(actorCards);
  },

  sortPopularity: (ev) => {
    ev.preventDefault();

    let key = STORAGE.Base_KEY + SEARCH.input;
    console.log(key);
    let actorCards = JSON.parse(localStorage.getItem(key));

    let srtPop = document.getElementById('srtPop');
    srtPop.classList.toggle('sort');

    actorCards.sort((a, b) => {
      if (srtPop.classList.contains('sort')) {
        srtPop.classList.add('asc');
        srtPop.classList.remove('des');

        if (a.popularity > b.popularity) {
          return 1;
        } else {
          return -1;
        }
      } else {
        srtPop.classList.remove('asc');
        srtPop.classList.add('des');

        if (a.popularity < b.popularity) {
          return 1;
        } else {
          return -1;
        }
      }
    });

    ACTORS.displayActors(actorCards);
  },
};

const MEDIA = {
  setHistory: (ev) => {
    let actorId = ev.target.closest('.card').getAttribute('data-id');

    // location.hash = SEARCH.input;
    history.pushState({}, SEARCH.input, `${location.href}/${actorId}`);
    MEDIA.displayMedias(actorId);
  },

  displayMedias: (actorId) => {
    let actorsPage = document.getElementById('actors');
    let mediaPage = document.getElementById('media');

    let actorH2 = document.getElementById('act');
    actorH2.addEventListener('click', MEDIA.previousPage);

    mediaPage.style.cssText = `
    animation: glass-enter 600ms cubic-bezier(0.2, 0.75, 0.25, 1) both;
    flex-direction: column;
    align-items:center;
   `;

    actorH2.style.display = 'block';
    actorsPage.style.display = 'none';
    mediaPage.style.display = 'flex';

    let key = STORAGE.Base_KEY + SEARCH.input;
    // console.log(key);

    const inputActor = JSON.parse(localStorage.getItem(key));
    // inputActor = JSON.parse(inputActor);

    let actor = inputActor.filter((actor) => {
      return actor.id == actorId;
    });

    console.log(actor[0].known_for);

    let dfMedia = document.createDocumentFragment();

    inputActor.forEach((mediaContent) => {
      if (mediaContent.id == actorId) {
        mediaContent.known_for.forEach((media) => {
          let col = document.createElement('div');
          col.className = 'col mb-2';

          let card = document.createElement('div');
          card.className = 'card';

          let cardBody = document.createElement('div');
          cardBody.className = 'card-body';

          let mediaImg = document.createElement('img');
          if (media.poster_path) {
            mediaImg.src = APP.IMG_BASE_URL + 'w500' + media.poster_path;
          } else {
            mediaImg.src = 'https://via.placeholder.com/150x226';
          }
          mediaImg.alt = media.title;

          let mediaName = document.createElement('h5');
          mediaName.className = 'card-title';

          let relDate = document.createElement('p');
          relDate.className = 'card-text';

          let mediaType = document.createElement('p');
          mediaType.className = 'card-text';

          mediaName.textContent = media.title;
          relDate.textContent = `Release Date: ${media.release_date}`;
          mediaType.textContent = `Type: ${media.media_type}`;

          cardBody.append(mediaName, relDate, mediaType);
          card.append(mediaImg, cardBody);
          col.append(card);

          dfMedia.appendChild(col);
        });
      }
    });
    let div = document.getElementById('mediaCard');
    div.innerHTML = '';
    div.append(dfMedia);
  },

  previousPage: (medias) => {
    medias.preventDefault();
    let actorsPage = document.getElementById('actors');
    let mediaPage = document.getElementById('media');

    mediaPage.style.display = 'none';
    actorsPage.style.display = 'flex';
  },
};

const NAV = {
  popHistory: () => {
    // document.getElementById('search').value = '';
    let input = location.hash;

    if (!input) {
      let actorsPage = document.getElementById('actors');
      let mediaPage = document.getElementById('media');
      let discoverPage = document.getElementById('discover');

      actorsPage.style.display = 'none';
      mediaPage.style.display = 'none';
      discoverPage.style.display = 'block';
    } else {
      if (/\d/.test(input)) {
        let actorID = input.split('/')[1];
        MEDIA.displayMedias(actorID);
      } else {
        SEARCH.input = input.replace('#', '');
        SEARCH.doSearch(input);
      }
    }
  },
};
document.addEventListener('DOMContentLoaded', APP.init);
