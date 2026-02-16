import View from './View.js';
import previewView from './previewView.js';

class ResultsView extends View {
  _errorMessage = `No recipe found for your query! Please try again ;) `;
  _message = ``;
  _parentElement = document.querySelector('.results');
  _generateMarkup() {
    return this._data.map(result => previewView.render(result, false)).join('');
  }
}
export default new ResultsView();
