/**
 * pdfSdk — Browser-compatible PDF parsing SDK
 *
 * Tree-shakable named exports. Import only what you need:
 *
 *   import { loadPdf }       from '../lib/pdfSdk';
 *   import { getPageInfo }   from '../lib/pdfSdk';
 *   import { extractText }   from '../lib/pdfSdk';
 *   import { classifyText }  from '../lib/pdfSdk';
 *   import { extractImages } from '../lib/pdfSdk';
 *
 * Or all at once:
 *   import { loadPdf, getPageInfo, extractText, classifyText, extractImages }
 *     from '../lib/pdfSdk';
 */

export { loadPdf }       from './loader.js';
export { getPageInfo }   from './pageInfo.js';
export { extractText }   from './textExtractor.js';
export { classifyText }  from './classifier.js';
export { extractImages } from './imageExtractor.js';
