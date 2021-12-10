'use strict';

const APP = {
  KEY: '1311585d0455175d1123297577a5dc06',
  baseURL: 'https://api.themoviedb.org/3/',
  IMG_BASE_URL: 'https://image.tmdb.org/t/p/',

  init: (ev) => {
    let searchBtn = document.getElementById('btnSearch');
    searchBtn.addEventListener('click', SEARCH.doSearch);
  },
};

const SEARCH = {
  results: [],
  input: '',

  doSearch: (ev) => {
    ev.preventDefault();
    SEARCH.input = document.getElementById('search').value;

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
    let url = `${APP.baseURL}search/person?api_key=${APP.KEY}&query=${SEARCH.input}&language=en-US`;

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
      card.addEventListener('click', MEDIA.displayMedias);
    });
    cards.append(df);
  },
};

const SORT = {
  sortName: () => {
    let key = STORAGE.Base_KEY + SEARCH.input;
    console.log(key);
    let actorCards = JSON.parse(localStorage.getItem(key));

    let cards = document.querySelector('.row');
    cards.innerHTML = '';

    actorCards.sort((a, b) => {
      if (a.name > b.name) {
        return 1;
      } else {
        return -1;
      }
    });

    let df = document.createDocumentFragment();

    actorCards.forEach((sname) => {
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

      if (sname.profile_path)
        actorImg.src = APP.IMG_BASE_URL + 'w500' + sname.profile_path;
      else actorImg.src = 'https://via.placeholder.com/150x226';

      actorImg.alt = sname.name;

      card.setAttribute('data-id', sname.id);
      actorName.textContent = sname.name;
      actorPop.textContent = `Popularity: ${sname.popularity}`;
      actKnown.textContent = `Known for: ${sname.known_for_department}`;

      col.append(card);
      card.append(actorImg, cardBody);
      cardBody.append(actorName, actKnown, actorPop);

      df.appendChild(col);

      card.addEventListener('click', MEDIA.displayMedias);
    });
    cards.append(df);
  },

  sortPopularity: () => {
    let key = STORAGE.Base_KEY + SEARCH.input;
    console.log(key);
    let actorCards = JSON.parse(localStorage.getItem(key));

    let cards = document.querySelector('.row');
    cards.innerHTML = '';

    actorCards.sort((a, b) => {
      if (a.popularity > b.popularity) {
        return 1;
      } else {
        return -1;
      }
    });

    let df = document.createDocumentFragment();

    actorCards.forEach((spopularity) => {
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

      if (spopularity.profile_path)
        actorImg.src = APP.IMG_BASE_URL + 'w500' + spopularity.profile_path;
      else actorImg.src = 'https://via.placeholder.com/150x226';

      actorImg.alt = spopularity.name;

      card.setAttribute('data-id', spopularity.id);
      actorName.textContent = spopularity.name;
      actorPop.textContent = `Popularity: ${spopularity.popularity}`;
      actKnown.textContent = `Known for: ${spopularity.known_for_department}`;

      col.append(card);
      card.append(actorImg, cardBody);
      cardBody.append(actorName, actKnown, actorPop);

      df.appendChild(col);

      card.addEventListener('click', MEDIA.displayMedias);
    });
    cards.append(df);
  },
};

const MEDIA = {
  medias: [],

  displayMedias: (medias) => {
    let actorsPage = document.getElementById('actors');
    let mediaPage = document.getElementById('media');

    let actorH2 = document.getElementById('act');
    actorH2.addEventListener('click', MEDIA.previousPage);

    actorsPage.style.display = 'none';
    mediaPage.style.display = 'flex';

    let actorId = medias.target.closest('.card').getAttribute('data-id');
    console.log(actorId);

    let key = STORAGE.Base_KEY + SEARCH.input;
    // console.log(key);

    let inputActor = JSON.parse(localStorage.getItem(key));
    // inputActor = JSON.parse(inputActor);

    // SEARCH.input;

    // let cards = document.querySelector('.row');
    // cards.innerHTML = '';

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

document.addEventListener('DOMContentLoaded', APP.init);
