import { TestBed } from '@angular/core/testing';
import { NotFoundComponent } from '../../src/app/features/not-found/not-found.component';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('NotFoundComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [NotFoundComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea correctamente', () => {
    const fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renderiza el icono y el botón de volver atrás', () => {
    const fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();

    const icon = fixture.nativeElement.querySelector('mat-icon');
    const button = fixture.nativeElement.querySelector('button');

    expect(icon).toBeTruthy();
    expect(button).toBeTruthy();
  });

  it('renderiza el contenedor principal con su estructura de bloques', () => {
    const fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.not-found-container')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.not-found-title')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.not-found-text')).toBeTruthy();
  });
});
