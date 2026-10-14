import { runApp } from './app';
import { packageRoot } from './paths';

runApp({ root: packageRoot(import.meta.url) });
