import { Component, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule } from "@jsverse/transloco";
import {MatIcon} from '@angular/material/icon';

@Component({
  selector: 'app-not-found',
  imports: [
    MatButtonModule,
    TranslocoModule,
    MatIcon,
  ],
  standalone: true,
  templateUrl: './not-found.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './not-found.component.scss'
})
export class NotFoundComponent {

}
