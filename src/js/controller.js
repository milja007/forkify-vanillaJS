import * as model from './model.js';
import { MODAL_CLOSE_SEC } from './config.js';
import recipeView from './views/recipeView.js';
import searchView from './views/searchView.js';
import resultsView from './views/resultsView.js';
import paginationView from './views/paginationView.js';
import bookMarksView from './views/bookMarksView.js';
import addRecipeView from './views/addRecipeView.js';

// if (module.hot) {
//   module.hot.accept();
// }
const controlRecipes = async function () {
  try {
    const id = window.location.hash.slice(1);

    if (!id) return;
    recipeView.renderSpinner();

    // 0) Update results view to mark selected search resoult
    resultsView.update(model.getSearchResultsPage());
    // 1) updating bookMarksView
    bookMarksView.update(model.state.bookMarked);

    //2) Loading recipe
    await model.loadRecipe(id);

    //3) rendering recipe
    recipeView.render(model.state.recipe);
  } catch (err) {
    recipeView.renderError();
    console.log(err);
  }
};
const controlSearchResults = async function () {
  try {
    resultsView.renderSpinner();
    //1)Get search query
    const query = searchView.getQuery();
    if (!query) return;
    //2)Load search results
    await model.loadSearchResults(query);
    // 3)render results
    // resultsView.render(model.state.search.results);
    resultsView.render(model.getSearchResultsPage());

    // 4) Render initial pagination buttons
    paginationView.render(model.state.search);
  } catch (err) {
    console.log(err);
  }
};

const controlPagination = function (goToPage) {
  // 1)render NEW results
  resultsView.render(model.getSearchResultsPage(goToPage));

  // 2) Render NEW pagination buttons
  paginationView.render(model.state.search);
};
const controlServings = function (newServings) {
  // update recipe servings (in state)
  model.updateServings(newServings);

  //update the recipe view
  recipeView.update(model.state.recipe);
};
const controlAddBookmark = function () {
  //add/remove bookmark
  if (!model.state.recipe.bookMarked) model.addBookmark(model.state.recipe);
  else model.deleteBookmark(model.state.recipe.id);

  //update recipe view
  recipeView.update(model.state.recipe);

  //render bookmarks
  bookMarksView.render(model.state.bookMarked);
};
const controlBookmarks = function () {
  bookMarksView.render(model.state.bookMarked);
};

const controlAddRecipe = async function (newRecipe) {
  try {
    //Show loading spinner
    addRecipeView.renderSpinner();
    //Upload new recipe data
    await model.uploadRecipe(newRecipe);
    console.log(model.state.recipe);
    //Render recipe
    recipeView.render(model.state.recipe);
    //success message
    addRecipeView.renderMessage();
    //render bookmark view
    bookMarksView.render(model.state.bookMarked);

    //change ID in URL
    window.history.pushState(null, '', `#${model.state.recipe.id}`);

    //cllose form window
    setTimeout(function () {
      addRecipeView.toggleWindow();
    }, MODAL_CLOSE_SEC * 1000);
  } catch (err) {
    console.error('$$$', err);
    addRecipeView.renderError(err.message);
  }
};
const init = function () {
  bookMarksView.addHandlerRender(controlBookmarks);
  recipeView.addHandlerRender(controlRecipes);
  recipeView.addHandlerUpdateServings(controlServings);
  recipeView.addHandlerAddBookmark(controlAddBookmark);
  searchView.addHandlerSearch(controlSearchResults);
  paginationView.addHandlerClick(controlPagination);
  addRecipeView.addHandlerUpload(controlAddRecipe);
};
init();
