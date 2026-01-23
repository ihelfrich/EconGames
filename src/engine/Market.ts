/**
 * Market Clearing Mechanism
 * Implements different market structures with price discovery
 * @author Dr. Ian Helfrich
 */

import type { MarketMode, MarketState, TradeResult } from '../types';
import { Buyer, Seller } from './Agent';

export class Market {
  private buyers: Buyer[] = [];
  private sellers: Seller[] = [];
  private tradeHistory: TradeResult[] = [];
  private currentMode: MarketMode = 'perfect';

  public priceFloor: number | null = null;
  public priceCeiling: number | null = null;

  constructor(mode: MarketMode = 'perfect') {
    this.currentMode = mode;
  }

  setMode(mode: MarketMode): void {
    this.currentMode = mode;
  }

  addBuyer(buyer: Buyer): void {
    this.buyers.push(buyer);
  }

  addSeller(seller: Seller): void {
    this.sellers.push(seller);
  }

  removeBuyer(id: string): void {
    this.buyers = this.buyers.filter(b => b.id !== id);
  }

  removeSeller(id: string): void {
    this.sellers = this.sellers.filter(s => s.id !== id);
  }

  getBuyers(): Buyer[] {
    return this.buyers;
  }

  getSellers(): Seller[] {
    return this.sellers;
  }

  /**
   * Main market clearing function - matches buyers and sellers
   */
  clearMarket(): TradeResult[] {
    const newTrades: TradeResult[] = [];

    switch (this.currentMode) {
      case 'perfect':
        newTrades.push(...this.clearPerfectCompetition());
        break;
      case 'monopoly':
        newTrades.push(...this.clearMonopoly());
        break;
      case 'oligopoly':
        newTrades.push(...this.clearOligopoly());
        break;
      case 'monopolistic':
        newTrades.push(...this.clearMonopolisticCompetition());
        break;
    }

    this.tradeHistory.push(...newTrades);
    return newTrades;
  }

  /**
   * Perfect Competition: Price-taking behavior, market clears at equilibrium
   */
  private clearPerfectCompetition(): TradeResult[] {
    const trades: TradeResult[] = [];

    // Sort buyers by willingness to pay (descending)
    const availableBuyers = this.buyers.filter(b => b.canTrade())
      .sort((a, b) => b.getWillingnessToPay() - a.getWillingnessToPay());

    // Sort sellers by willingness to accept (ascending)
    const availableSellers = this.sellers.filter(s => s.canTrade())
      .sort((a, b) => a.getWillingnessToPay() - b.getWillingnessToPay());

    // Find equilibrium price (where supply meets demand)
    const equilibriumPrice = this.findEquilibriumPrice(availableBuyers, availableSellers);

    // Execute trades at equilibrium price
    let i = 0;
    while (i < availableBuyers.length && i < availableSellers.length) {
      const buyer = availableBuyers[i];
      const seller = availableSellers[i];

      if (buyer.getWillingnessToPay() >= equilibriumPrice &&
          seller.getWillingnessToPay() <= equilibriumPrice) {

        const price = this.applyPriceControls(equilibriumPrice);

        buyer.executeTradeAt(price);
        seller.executeTradeAt(price);

        trades.push({
          buyerId: buyer.id,
          sellerId: seller.id,
          price: price,
          quantity: 1,
          timestamp: Date.now(),
          buyerSurplus: buyer.getSurplusFrom(price),
          sellerSurplus: seller.getSurplusFrom(price)
        });
      }
      i++;
    }

    return trades;
  }

  /**
   * Monopoly: Single seller sets price to maximize profit (MR = MC)
   */
  private clearMonopoly(): TradeResult[] {
    const trades: TradeResult[] = [];

    if (this.sellers.length === 0) return trades;

    // Monopolist restricts quantity to raise price
    const monopolist = this.sellers[0];
    const buyers = this.buyers.filter(b => b.canTrade())
      .sort((a, b) => b.getWillingnessToPay() - a.getWillingnessToPay());

    // Monopolist price: higher than competitive equilibrium
    const competitivePrice = this.findEquilibriumPrice(buyers, this.sellers);
    const monopolyPrice = competitivePrice * 1.5; // Simplified: 50% markup

    // Only trade with buyers willing to pay monopoly price
    for (const buyer of buyers) {
      if (!monopolist.canTrade()) break;

      if (buyer.getWillingnessToPay() >= monopolyPrice) {
        const price = this.applyPriceControls(monopolyPrice);

        buyer.executeTradeAt(price);
        monopolist.executeTradeAt(price);

        trades.push({
          buyerId: buyer.id,
          sellerId: monopolist.id,
          price: price,
          quantity: 1,
          timestamp: Date.now(),
          buyerSurplus: buyer.getSurplusFrom(price),
          sellerSurplus: monopolist.getSurplusFrom(price)
        });
      }
    }

    return trades;
  }

  /**
   * Oligopoly: Few sellers engage in strategic pricing
   */
  private clearOligopoly(): TradeResult[] {
    const trades: TradeResult[] = [];

    const oligopolists = this.sellers.slice(0, Math.min(4, this.sellers.length));
    const buyers = this.buyers.filter(b => b.canTrade())
      .sort((a, b) => b.getWillingnessToPay() - a.getWillingnessToPay());

    const competitivePrice = this.findEquilibriumPrice(buyers, oligopolists);

    // Each oligopolist sets price slightly above competitive (Cournot-like)
    const oligopolyPrice = competitivePrice * 1.2;

    let buyerIndex = 0;
    for (const seller of oligopolists) {
      while (seller.canTrade() && buyerIndex < buyers.length) {
        const buyer = buyers[buyerIndex];

        if (buyer.getWillingnessToPay() >= oligopolyPrice) {
          const price = this.applyPriceControls(oligopolyPrice);

          buyer.executeTradeAt(price);
          seller.executeTradeAt(price);

          trades.push({
            buyerId: buyer.id,
            sellerId: seller.id,
            price: price,
            quantity: 1,
            timestamp: Date.now(),
            buyerSurplus: buyer.getSurplusFrom(price),
            sellerSurplus: seller.getSurplusFrom(price)
          });
        }
        buyerIndex++;
      }
    }

    return trades;
  }

  /**
   * Monopolistic Competition: Many sellers with differentiated products
   */
  private clearMonopolisticCompetition(): TradeResult[] {
    const trades: TradeResult[] = [];

    const sellers = this.sellers.filter(s => s.canTrade());
    const buyers = this.buyers.filter(b => b.canTrade());

    // Each seller has some price-setting power due to product differentiation
    for (const seller of sellers) {
      const competitivePrice = seller.getWillingnessToPay();
      const differentiatedPrice = competitivePrice * (1 + Math.random() * 0.3); // 0-30% markup

      // Buyers choose based on price and "brand preference" (random here)
      const interestedBuyers = buyers
        .filter(b => b.canTrade() && b.getWillingnessToPay() >= differentiatedPrice)
        .sort(() => Math.random() - 0.5); // Shuffle for variety

      if (interestedBuyers.length > 0 && seller.canTrade()) {
        const buyer = interestedBuyers[0];
        const price = this.applyPriceControls(differentiatedPrice);

        buyer.executeTradeAt(price);
        seller.executeTradeAt(price);

        trades.push({
          buyerId: buyer.id,
          sellerId: seller.id,
          price: price,
          quantity: 1,
          timestamp: Date.now(),
          buyerSurplus: buyer.getSurplusFrom(price),
          sellerSurplus: seller.getSurplusFrom(price)
        });
      }
    }

    return trades;
  }

  private findEquilibriumPrice(buyers: Buyer[], sellers: Seller[]): number {
    if (buyers.length === 0 || sellers.length === 0) return 50; // Default

    // Simple average of marginal buyer and marginal seller
    const marginalBuyerPrice = buyers[Math.min(buyers.length - 1, sellers.length - 1)].getWillingnessToPay();
    const marginalSellerPrice = sellers[Math.min(buyers.length - 1, sellers.length - 1)].getWillingnessToPay();

    return (marginalBuyerPrice + marginalSellerPrice) / 2;
  }

  private applyPriceControls(price: number): number {
    if (this.priceCeiling !== null && price > this.priceCeiling) {
      return this.priceCeiling;
    }
    if (this.priceFloor !== null && price < this.priceFloor) {
      return this.priceFloor;
    }
    return price;
  }

  getMarketState(): MarketState {
    const recentTrades = this.tradeHistory.slice(-100);
    const avgPrice = recentTrades.length > 0
      ? recentTrades.reduce((sum, t) => sum + t.price, 0) / recentTrades.length
      : 0;

    const consumerSurplus = recentTrades.reduce((sum, t) => sum + t.buyerSurplus, 0);
    const producerSurplus = recentTrades.reduce((sum, t) => sum + t.sellerSurplus, 0);

    return {
      mode: this.currentMode,
      equilibriumPrice: avgPrice,
      equilibriumQuantity: recentTrades.length,
      totalTransactions: this.tradeHistory.length,
      averagePrice: avgPrice,
      consumerSurplus,
      producerSurplus,
      deadweightLoss: this.calculateDeadweightLoss()
    };
  }

  private calculateDeadweightLoss(): number {
    // Simplified DWL calculation based on market mode
    if (this.currentMode === 'perfect') return 0;

    const recentTrades = this.tradeHistory.slice(-100);
    const totalSurplus = recentTrades.reduce((sum, t) =>
      sum + t.buyerSurplus + t.sellerSurplus, 0);

    // Estimate DWL as percentage of surplus lost
    const dwlFactor = this.currentMode === 'monopoly' ? 0.3 :
                     this.currentMode === 'oligopoly' ? 0.15 : 0.05;

    return totalSurplus * dwlFactor;
  }

  reset(): void {
    this.buyers = [];
    this.sellers = [];
    this.tradeHistory = [];
  }
}
