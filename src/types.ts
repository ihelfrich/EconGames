/**
 * Core type definitions for EconGames
 * @author Dr. Ian Helfrich
 */

export type MarketMode = 'perfect' | 'monopoly' | 'oligopoly' | 'monopolistic';

export interface AgentConfig {
  id: string;
  type: 'buyer' | 'seller';
  reservationPrice: number; // Maximum willing to pay (buyer) or minimum willing to accept (seller)
  budget: number; // For buyers
  inventory: number; // For sellers
  utilityFunction?: (quantity: number) => number;
  costFunction?: (quantity: number) => number;
}

export interface TradeResult {
  buyerId: string;
  sellerId: string;
  price: number;
  quantity: number;
  timestamp: number;
  buyerSurplus: number;
  sellerSurplus: number;
}

export interface MarketState {
  mode: MarketMode;
  equilibriumPrice: number;
  equilibriumQuantity: number;
  totalTransactions: number;
  averagePrice: number;
  consumerSurplus: number;
  producerSurplus: number;
  deadweightLoss: number;
}

export interface Point {
  x: number;
  y: number;
}
