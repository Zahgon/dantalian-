import { withContext } from '../errors.js';
import { debug } from '../logger.js';
import { EPISODE_TEMPLATE, MOVIE_TEMPLATE, TVSHOW_TEMPLATE } from './nfo.js';
import { TinyTemplate } from './tinytemplate.js';

/**
 * Renders nfo documents from the view models in `./nfo.js`.
 */
export class Generator {
  constructor() {
    this.tt = new TinyTemplate();
    this.tt.addTemplate('movie', MOVIE_TEMPLATE);
    this.tt.addTemplate('tvshow', TVSHOW_TEMPLATE);
    this.tt.addTemplate('episode', EPISODE_TEMPLATE);
  }

  /**
   * @param {import('./nfo.js').Movie} movie
   * @returns {string}
   */
  genMovieNfo(movie) {
    const rendered = this.#render('movie', movie, 'render movie');
    debug(`generated movie nfo file:\n${rendered}`);
    return rendered;
  }

  /**
   * @param {import('./nfo.js').TVShow} tvshow
   * @returns {string}
   */
  genTvshowNfo(tvshow) {
    const rendered = this.#render('tvshow', tvshow, 'render tvshow');
    debug(`generated tvshow nfo file:\n${rendered}`);
    return rendered;
  }

  /**
   * @param {import('./nfo.js').Episode} episode
   * @returns {string}
   */
  genEpisodeNfo(episode) {
    const rendered = this.#render('episode', episode, 'render episode');
    debug(`generated episode nfo file:\n${rendered}`);
    return rendered;
  }

  /**
   * @param {string} name
   * @param {unknown} context
   * @param {string} contextMessage
   * @returns {string}
   */
  #render(name, context, contextMessage) {
    try {
      return this.tt.render(name, context);
    } catch (error) {
      throw withContext(error, contextMessage);
    }
  }
}
