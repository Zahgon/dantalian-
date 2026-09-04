import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { Generator } from '../src/nfogen/generator.js';
import { TinyTemplate } from '../src/nfogen/tinytemplate.js';
import { golden, loadAnimeFixture, loadMovieFixture } from './helpers/fixtures.js';

function render(template, context) {
  const engine = new TinyTemplate();
  engine.addTemplate('t', template);
  return engine.render('t', context);
}

describe('tinytemplate value rendering', () => {
  it('escapes exactly the five characters TinyTemplate escapes', () => {
    assert.equal(render('{v}', { v: `A&B<c>"q"'s' / \\ é 日本` }), 'A&amp;B&lt;c&gt;&quot;q&quot;&#39;s&#39; / \\ é 日本');
  });

  it('never trims whitespace around block tags', () => {
    const template = 'A\n    {{ if poster }}<thumb>{poster}</thumb>{{ endif }}\n    {{ if eps }}<e>{eps}</e>{{ endif }}\nB{{ for i in items }}\n    <i>{i}</i>{{ endfor }}\nC\n';
    assert.equal(render(template, { poster: null, eps: 0, items: [] }), 'A\n    \n    \nB\nC\n');
  });

  it('uses serde_json truthiness for if blocks', () => {
    const template = '{{ if v }}T{{ else }}F{{ endif }}';
    for (const falsey of [null, false, 0, '', []]) {
      assert.equal(render(template, { v: falsey }), 'F', `expected ${JSON.stringify(falsey)} to be falsey`);
    }
    for (const truthy of [true, 1, 'x', ['a']]) {
      assert.equal(render(template, { v: truthy }), 'T', `expected ${JSON.stringify(truthy)} to be truthy`);
    }
  });

  it('fails on an unknown field rather than rendering blank', () => {
    assert.throws(() => render('{nope}', { v: 1 }));
  });
});

describe('nfo generation against Rust-produced goldens', () => {
  const generator = new Generator();

  it('renders tvshow.nfo byte-identically', () => {
    const { tvshow } = loadAnimeFixture();
    assert.equal(generator.genTvshowNfo(tvshow), readFileSync(golden('nfo/tvshow_1671.nfo'), 'utf8'));
  });

  it('renders a regular episode byte-identically', () => {
    const { episodes } = loadAnimeFixture();
    const episode = episodes.find((e) => e.ep_index === '1' && !e.is_sp);
    assert.equal(generator.genEpisodeNfo(episode), readFileSync(golden('nfo/episode_1671_01.nfo'), 'utf8'));
  });

  it('renders a special episode byte-identically, keeping premiered and aired on one line', () => {
    const { episodes } = loadAnimeFixture();
    const episode = episodes.find((e) => e.ep_index === '5.5' && e.is_sp);
    const rendered = generator.genEpisodeNfo(episode);
    assert.equal(rendered, readFileSync(golden('nfo/episode_1671_sp5.5.nfo'), 'utf8'));
    assert.match(rendered, /<premiered>2009-07-03<\/premiered><aired>2009-08-07<\/aired>/);
    assert.match(rendered, /<season>0<\/season>/);
  });

  it('renders movie.nfo byte-identically and never emits an actor block', () => {
    const rendered = generator.genMovieNfo(loadMovieFixture());
    assert.equal(rendered, readFileSync(golden('nfo/movie_244761.nfo'), 'utf8'));
    assert.ok(!rendered.includes('<actor>'));
  });
});
