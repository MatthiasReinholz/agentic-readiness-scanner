import { defineCheck, fail, pass } from '../types.js';
import { homeNoindex, homeRobotsDirectives, robotsBlocksSearch } from './shared.js';

export const squareSearchVisibility = defineCheck('A2.11', ({ target }) => {
  const directives = homeRobotsDirectives(target);
  const noindex = homeNoindex(target);
  const robots = robotsBlocksSearch(target.robots);
  const evidence = {
    robots_meta: directives.meta,
    x_robots_tag: directives.header,
    robots_txt_blocks_search: robots,
  };
  if (!noindex && !robots) {
    return pass('the site is not hidden from search engines', evidence);
  }
  return fail(
    `the site is hidden from search engines (${[noindex ? 'the home page carries noindex' : '', robots ? 'robots.txt disallows Googlebot and Bingbot everywhere' : ''].filter(Boolean).join(', and ')}). Check "Hidden from search engine results" in the site's SEO settings`,
    evidence,
  );
});
