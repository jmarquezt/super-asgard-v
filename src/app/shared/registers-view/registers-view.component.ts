import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatTab, MatTabGroup } from '@angular/material/tabs';
import { FormsModule } from '@angular/forms';
import { MatAccordion, MatExpansionPanel, MatExpansionPanelDescription, MatExpansionPanelHeader, MatExpansionPanelTitle } from '@angular/material/expansion';
import { TranslocoDirective } from '@jsverse/transloco';
import { NumberFormatPipe } from '../pipes/number-format.pipe';
import { AsgProcessorFactoryService } from '../../core/services/processor/asg.processor-factory';
import { AsgSuperscalarProcessorService } from '../../core/services/processor/asg.superscalar.processor';

@Component({
  selector: 'app-registers-view',
  templateUrl: './registers-view.component.html',
  imports: [
    MatIcon,
    MatButtonToggleGroup,
    MatButtonToggle,
    MatTabGroup,
    MatTab,
    NumberFormatPipe,
    FormsModule,
    MatAccordion,
    MatExpansionPanel,
    MatExpansionPanelHeader,
    MatExpansionPanelTitle,
    MatExpansionPanelDescription,
    TranslocoDirective
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./registers-view.component.scss']
})
export class RegistersViewComponent {
  private processorFactory = inject(AsgProcessorFactoryService);

  isSuperscalar = computed(() => this.processorFactory.isSuperscalar());

  // Signals that work with both processor types
  registers = computed(() => {
    return this.processorFactory.getProcessor().getRegisters();
  });

  floatRegisters = computed(() => {
    return this.processorFactory.getProcessor().getFloatRegisters();
  });

  vectorRegisters = computed(() => {
    return this.processorFactory.getProcessor().getVectorRegisters();
  });

  // Estado local para el Pipe que creamos
  displayMode: 'hex' | 'dec' | 'bin' = 'dec';

  // Unified accessors for both processor types
  lastModifiedReg = computed(() => {
    return this.processorFactory.getProcessor().getLastModifiedRegister();
  });

  fpConditionBit = computed(() => {
    return this.processorFactory.getProcessor().getFPConditionBit();
  });

  vl = computed(() => {
    return this.processorFactory.getProcessor().getVl();
  });

  MVL = computed(() => {
    return this.processorFactory.getProcessor().MVL;
  });

  vectorMask = computed(() => {
    return this.processorFactory.getProcessor().getVectorMask();
  });

  iar = computed(() => {
    return this.processorFactory.getProcessor().iar();
  });

  getFloatValue(index: number, isDouble: boolean): number {
    return this.processorFactory.getProcessor().getFloatValue(index, isDouble);
  }

  // Helper para saber si un registro tiene algún valor distinto de cero
  // (Ayuda al usuario a saber dónde mirar)
  hasData(regIdx: number): boolean {
    return this.vectorRegisters()[regIdx].some(val => val !== 0);
  }

  isRegModified(index: number): boolean {
    const last = this.processorFactory.getProcessor().getLastModifiedRegister();

    if (!last || last.type !== 'F' && last.type !== 'D') return false;

    if (last.type === 'D') {
      return index === last.index || index === last.index + 1;
    }

    return index === last.index;
  }

  isDouble(index: number): boolean {
    if (index % 2 !== 0) return false;

    return this.processorFactory.getProcessor().registerFile.floatRegisterTypes()[index] === 'D';
  }

  rrfState = computed(() => {
    if (!this.isSuperscalar()) return null;

    const proc = this.processorFactory.getProcessor() as AsgSuperscalarProcessorService;
    proc.cycle();

    return proc.getRRFState();
  });

  getIntRRF(index: number): { ocupado: boolean; slot: number | null } {
    const state = this.rrfState();
    if (!state) return { ocupado: false, slot: null };
    const entry = state.intRegs[index];
    return { ocupado: entry.ocupado, slot: entry.indice?.slot ?? null };
  }

  getFloatRRF(index: number): { ocupado: boolean; slot: number | null } {
    const state = this.rrfState();
    if (!state) return { ocupado: false, slot: null };
    const entry = state.floatRegs[index];
    return { ocupado: entry.ocupado, slot: entry.indice?.slot ?? null };
  }

  getVectorRRF(index: number): { ocupado: boolean; slot: number | null } {
    const state = this.rrfState();
    if (!state) return { ocupado: false, slot: null };
    const entry = state.vectorRegs[index];
    return { ocupado: entry.ocupado, slot: entry.indice?.slot ?? null };
  }

}
