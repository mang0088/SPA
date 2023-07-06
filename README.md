# Website Features Description
This repository contains a website that provides the following features, utilizing TheMovieDB API to fetch actors and movies data:

## Save Search Results to localStorage
The website allows users to save the results of their searches to the browser's localStorage. Each search result is stored using the value from the search field as the key. This feature ensures that subsequent searches with the same key can be retrieved from the localStorage without making a fetch request.

## History API and Location Hash
- The website utilizes the History API to update the URL dynamically, reflecting the search term and the current screen of the application. The location.hash is used to include details about the user's current location within the app. The following locations are supported:

- Home Page with No Results: Represents the initial landing page of the website when no search results are available.

- Tim Actors Page: Displays search results for the term "tim" fetched from TheMovieDB API. This page is accessible through the search functionality, and the search results are stored in localStorage.

- Tim/123324 Media Page: Shows the search results for the actor with the ID 123324 fetched from TheMovieDB API. The Actors Page (accessible via the #tim location) also includes results for the search term "tim".

## Sorting Results
Users can control the sorting of search results based on either the name or popularity of the items. The website provides a toggle option that allows users to switch between ascending and descending order for both name and popularity sorting.

## Handling Back Button Navigation
To ensure smooth navigation, the website utilizes the popstate event to handle back button navigation. Alternatively, the hashchange event can be used as an alternative method for handling back-button navigation.

## CSS Transitions
CSS transitions have been implemented to enhance the user experience during navigation between different pages. The transitions have a duration ranging from 0.3 seconds to 0.9 seconds, providing a smooth visual effect.

## Loading Animation Overlay
Whenever a fetch request is made to TheMovieDB API, a loading animation overlay appears to provide visual feedback to the user. This overlay indicates that a process is ongoing in the background.

## Error Message Display
- In case of a failure to fetch data from TheMovieDB API, the website displays an error message to alert the user. This feature ensures that users are informed when there is an issue retrieving the requested data.

- Please refer to the website for a live demonstration of these features. TheMovieDB API integration provides access to a wide range of actors and movies data. Feel free to explore the code and provide any feedback or suggestions.
