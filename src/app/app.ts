import {Component, inject, signal, ChangeDetectionStrategy} from '@angular/core';
import {NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterOutlet} from '@angular/router';
import {LoaderService} from './services/loader';
import {LoaderComponent} from './layout/loader/loader.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, LoaderComponent],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('super-asgard-v');

  private router = inject(Router);
  protected loaderService = inject(LoaderService);
  private initialLoadComplete = false;

  constructor() {
    // Show loading on initial load
    this.loaderService.show();

    // Listen to router events
    this.router.events.subscribe(event => {
      if (event instanceof NavigationStart) {
        if (this.initialLoadComplete) {
          this.loaderService.show();
        }
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        // Small delay to avoid flickering
        setTimeout(() => {
          this.loaderService.hide();
          this.initialLoadComplete = true;
        }, 100);
      }
    });
  }
}
