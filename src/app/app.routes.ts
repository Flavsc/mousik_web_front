import { Routes } from '@angular/router';

export const appRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'workspace'
  },
  {
    path: 'workspace',
    loadComponent: () =>
      import('./features/workspace/mousik-workspace.component').then(
        (module) => module.MousikWorkspaceComponent
      )
  },
  {
    path: '**',
    redirectTo: 'workspace'
  }
];
