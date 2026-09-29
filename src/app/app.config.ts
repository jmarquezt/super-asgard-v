import {ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import {TranslocoHttpLoader} from './transloco-loader';
import {provideTransloco} from '@jsverse/transloco';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideTransloco({
      config: {
        availableLangs: ['en', 'es'],
        defaultLang: 'es',
        // Remove this option if your application doesn't support changing language in runtime.
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
      },
      loader: TranslocoHttpLoader,
    })
  ]
};
