// Picks the backend adapter. Both expose the same interface (see store-dev.js).
// localhost / 127.0.0.1 -> dev server (never touches the real database); ?prod=1 forces Firebase. Other hosts always use Firebase.
import { firebaseConfig } from './firebase-config.js';

const q = new URLSearchParams(location.search);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
export const usesDev = !firebaseConfig || (q.get('prod') !== '1' && local);

const mod = usesDev ? await import('./store-dev.js') : await import('./store-firebase.js');
export const store = await mod.createStore(firebaseConfig);
