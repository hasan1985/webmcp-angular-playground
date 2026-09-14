import {Routes} from '@angular/router';

export const routes: Routes = [
  {path: '', pathMatch: 'full', redirectTo: 'game'},
  {path: 'game', loadComponent: () => import('./game/game.page').then((m) => m.GamePage)},
  {path: 'notes', loadComponent: () => import('./notes/notes.page').then((m) => m.NotesPage)},
];
