import { defineCheck, fail, pass } from '../types.js';
import { disallowed, robotsBlocksSearch } from './shared.js';

/** Where SFRA and SiteGenesis storefronts serve scripts, styles and images. */
const STATIC_PATH = '/on/demandware.static/';

export const salesforceRobotsPreset = defineCheck('A2.12', ({ target }) => {
  const blocksSearch = robotsBlocksSearch(target.robots);
  const blocksStatic = disallowed(target.robots, ['Googlebot', 'Bingbot'], STATIC_PATH);
  const evidence = {
    robots_txt_blocks_search: blocksSearch,
    static_path: STATIC_PATH,
    static_blocked_for: blocksStatic,
  };
  if (blocksSearch) {
    return fail(
      'robots.txt disallows Googlebot and Bingbot everywhere, as the "All Spiders Disallowed to Access Any Static Resources" preset for staging instances does. It is often replicated to production with the site preferences',
      evidence,
    );
  }
  if (blocksStatic.length > 0) {
    return fail(
      `robots.txt disallows ${STATIC_PATH} for ${blocksStatic.join(' and ')}, so crawlers cannot load the scripts, styles and images the pages need`,
      evidence,
    );
  }
  return pass(
    'robots.txt lets search crawlers reach the storefront and its static resources',
    evidence,
  );
});
