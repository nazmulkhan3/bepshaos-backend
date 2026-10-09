import { Injectable, NotFoundException } from '@nestjs/common';
import { IBillingProvider } from '../interfaces/billing-provider.interface.js';
import { DummyBillingProvider } from './dummy-billing.provider.js';

@Injectable()
export class BillingProviderRegistry {
  private readonly providers = new Map<string, IBillingProvider>();

  constructor(private readonly dummyProvider: DummyBillingProvider) {
    this.registerProvider('MANUAL', this.dummyProvider);
    this.registerProvider('INTERNAL_SYSTEM', this.dummyProvider);
    this.registerProvider('DUMMY', this.dummyProvider);
  }

  registerProvider(name: string, provider: IBillingProvider) {
    this.providers.set(name.toUpperCase(), provider);
  }

  getProvider(name: string): IBillingProvider {
    const provider = this.providers.get(name.toUpperCase());
    if (!provider) {
      throw new NotFoundException(`Billing provider '${name}' is not registered`);
    }
    return provider;
  }
}
