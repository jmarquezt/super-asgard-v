import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));

(window as any).MonacoEnvironment = {
  getWorkerUrl: function(moduleId: string, label: string) {
    if (label === 'json') {
      return './assets/monaco/esm/vs/language/json/json.worker.js'
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return './assets/monaco/esm/vs/language/css/css.worker.js'
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return './assets/monaco/esm/vs/language/html/html.worker.js'
    }
    if (label === 'typescript' || label === 'javascript') {
      return './assets/monaco/esm/vs/language/typescript/ts.worker.js'
    }
    return './assets/monaco/esm/vs/editor/editor.worker.js'
  }
};
