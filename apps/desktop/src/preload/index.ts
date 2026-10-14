import { contextBridge, ipcRenderer } from 'electron';
import { createApi } from './api';

/** `window.api` (H4) : rien d'autre que `createApi` ne passe au renderer. */
contextBridge.exposeInMainWorld('api', createApi(ipcRenderer));
