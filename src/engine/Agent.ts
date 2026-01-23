/**
 * Economic Agent Base Class
 * Represents rational economic actors (buyers/sellers) with utility/cost functions
 * @author Dr. Ian Helfrich
 */

import type { AgentConfig, Point } from '../types';

export abstract class Agent {
  public readonly id: string;
  public readonly type: 'buyer' | 'seller';
  public reservationPrice: number;
  public position: Point;
  public velocity: Point;
  public isTrading: boolean = false;
  public tradeHistory: number[] = [];

  constructor(config: AgentConfig) {
    this.id = config.id;
    this.type = config.type;
    this.reservationPrice = config.reservationPrice;
    this.position = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
  }

  abstract canTrade(): boolean;
  abstract executeTradeAt(price: number): void;
  abstract getWillingnessToPay(): number;

  public updateReservationPrice(marketPrice: number, learningRate: number = 0.1): void {
    // Agents learn from market prices and adjust expectations
    this.reservationPrice += learningRate * (marketPrice - this.reservationPrice);
  }

  public getSurplusFrom(price: number): number {
    if (this.type === 'buyer') {
      return Math.max(0, this.reservationPrice - price);
    } else {
      return Math.max(0, price - this.reservationPrice);
    }
  }
}

export class Buyer extends Agent {
  public budget: number;
  public utilityFunction: (q: number) => number;
  private quantityOwned: number = 0;

  constructor(config: AgentConfig) {
    super(config);
    this.budget = config.budget;
    this.utilityFunction = config.utilityFunction || ((q) => Math.sqrt(q) * 100);
  }

  canTrade(): boolean {
    return this.budget > 0 && !this.isTrading;
  }

  executeTradeAt(price: number): void {
    if (price <= this.budget && price <= this.reservationPrice) {
      this.budget -= price;
      this.quantityOwned++;
      this.tradeHistory.push(price);

      // Update reservation price based on diminishing marginal utility
      const marginalUtility = this.utilityFunction(this.quantityOwned + 1) -
                             this.utilityFunction(this.quantityOwned);
      this.reservationPrice = marginalUtility;
    }
  }

  getWillingnessToPay(): number {
    // Marginal utility of next unit
    const marginalUtility = this.utilityFunction(this.quantityOwned + 1) -
                           this.utilityFunction(this.quantityOwned);
    return Math.min(marginalUtility, this.budget);
  }

  getQuantityOwned(): number {
    return this.quantityOwned;
  }
}

export class Seller extends Agent {
  public inventory: number;
  public costFunction: (q: number) => number;
  private quantitySold: number = 0;

  constructor(config: AgentConfig) {
    super(config);
    this.inventory = config.inventory;
    this.costFunction = config.costFunction || ((q) => q * q * 2); // Increasing marginal cost
  }

  canTrade(): boolean {
    return this.inventory > 0 && !this.isTrading;
  }

  executeTradeAt(price: number): void {
    if (price >= this.reservationPrice && this.inventory > 0) {
      this.inventory--;
      this.quantitySold++;
      this.tradeHistory.push(price);

      // Update reservation price based on increasing marginal cost
      const marginalCost = this.costFunction(this.quantitySold + 1) -
                          this.costFunction(this.quantitySold);
      this.reservationPrice = marginalCost;
    }
  }

  getWillingnessToPay(): number {
    // For sellers, this is minimum willing to accept (marginal cost)
    const marginalCost = this.costFunction(this.quantitySold + 1) -
                        this.costFunction(this.quantitySold);
    return marginalCost;
  }

  getQuantitySold(): number {
    return this.quantitySold;
  }
}
