import { Routes } from '@angular/router';
import { FullPageComponent } from './layout/full-page/full-page.component';

export const routes: Routes = [
  {
    path: '',
    component: FullPageComponent,
    children: [
      {
        path: '', // Ruta completa: /
        loadComponent: () => import('./features/main/main.component').then(c => c.MainComponent)
      },
      {
        path: 'docs',
        loadComponent: () => import('./features/docs/docs.component').then(c => c.DocsComponent)
      }
    ]
  },
  // Ruta para página no encontrada al final
  {
    path: '**',
    loadComponent: () => import('./features/not-found/not-found.component').then(c => c.NotFoundComponent)
  },
];
