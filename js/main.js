'use strict';

const APP = {
  KEY: '1311585d0455175d1123297577a5dc06',
  baseURL: 'https://api.themoviedb.org/3/',
  IMG_BASE_URL: 'https://image.tmdb.org/t/p/',

  init: () => {
    history.replaceState(null, '', '#');
    window.addEventListener('popstate', NAV.popHistory);
    let searchBtn = document.getElementById('btnSearch');
    searchBtn.addEventListener('click', SEARCH.getInput);
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
    console.log(APP.KEY);
    let url = `${APP.baseURL}search/person?api_key=${APP.KEY}&query=${SEARCH.input}&language=en-US`;

    document.getElementById(
      'actors'
    ).innerHTML = `<div class="mvLoading"></div>`;

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
        // console.log(data);
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
  },
};

const ACTORS = {
  actors: [],

  displayActors: (actors) => {
    let homePage = document.getElementById('instructions');
    let actorsPage = document.getElementById('actors');

    homePage.style.display = 'none';
    actorsPage.style.display = 'flex';

    let cards = document.querySelector('.row');
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

      col.className = 'col';
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

    actorsPage.style.display = 'none';
    mediaPage.style.display = 'flex';

    let key = STORAGE.Base_KEY + SEARCH.input;
    // console.log(key);

    let inputActor = JSON.parse(localStorage.getItem(key));
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
          col.className = 'col';

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
      let homePage = document.getElementById('instructions');

      actorsPage.style.display = 'none';
      mediaPage.style.display = 'none';
      homePage.style.display = 'block';
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
