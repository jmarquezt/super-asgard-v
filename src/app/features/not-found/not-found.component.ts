import { Component } from '@angular/core';
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
  templateUrl: './not-found.component.html',
  styleUrl: './not-found.component.scss'
})
export class NotFoundComponent {

}
