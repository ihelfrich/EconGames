/**
 * Educational Overlay System - Real-time economic insights
 * @author Dr. Ian Helfrich
 */

import type { MarketMode } from '../types';

interface Insight {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'insight';
  duration?: number;
}

export class EducationOverlay {
  private overlayElement!: HTMLDivElement;
  private insightsContainer!: HTMLDivElement;
  private conceptBox!: HTMLDivElement;
  private activeInsights: Set<string> = new Set();
  private lastPrice: number = 0;
  private lastMode: MarketMode = 'perfect';

  constructor() {
    this.injectStyles();
    this.createOverlay();
  }

  private createOverlay(): void {
    const overlay = document.createElement('div');
    overlay.id = 'education-overlay';
    overlay.style.cssText = `position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 500;`;

    const insightsContainer = document.createElement('div');
    insightsContainer.id = 'insights-container';
    insightsContainer.style.cssText = `position: absolute; bottom: 160px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; width: min(90vw, 520px);`;

    const conceptBox = document.createElement('div');
    conceptBox.id = 'concept-box';
    conceptBox.style.cssText = `position: absolute; top: 80px; left: 50%; transform: translateX(-50%); background: linear-gradient(135deg, rgba(47, 128, 237, 0.95), rgba(34, 197, 94, 0.95)); color: white; padding: 20px 24px; border-radius: 12px; box-shadow: 0 10px 32px rgba(15, 23, 42, 0.35); width: min(90vw, 520px); display: none; backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.25); font-family: 'Space Grotesk', 'Segoe UI', sans-serif;`;

    overlay.appendChild(insightsContainer);
    overlay.appendChild(conceptBox);

    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      gameContainer.appendChild(overlay);
    }

    this.overlayElement = overlay;
    this.insightsContainer = insightsContainer;
    this.conceptBox = conceptBox;
  }

  showConcept(title: string, explanation: string, duration: number = 5000): void {
    this.conceptBox.innerHTML = `<div style="font-size: 18px; font-weight: bold; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;"><span style="font-size: 24px;">💡</span>${title}</div><div style="font-size: 14px; line-height: 1.6; opacity: 0.95;">${explanation}</div>`;
    this.conceptBox.style.display = 'block';
    this.conceptBox.style.animation = 'slideInDown 0.4s ease-out';
    if (duration > 0) {
      setTimeout(() => {
        this.conceptBox.style.animation = 'slideOutUp 0.3s ease-in';
        setTimeout(() => { this.conceptBox.style.display = 'none'; }, 300);
      }, duration);
    }
  }

  showInsight(insight: Insight): void {
    if (this.activeInsights.has(insight.id)) return;
    this.activeInsights.add(insight.id);

    const insightEl = document.createElement('div');
    insightEl.style.cssText = `padding: 12px 16px; border-radius: 10px; box-shadow: 0 10px 22px rgba(15, 23, 42, 0.25); font-size: 13px; font-family: 'Space Grotesk', 'Segoe UI', sans-serif; animation: slideInRight 0.3s ease-out; pointer-events: all; cursor: pointer; backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.3);`;

    const colors = {
      info: 'linear-gradient(135deg, rgba(47, 128, 237, 0.95), rgba(14, 165, 233, 0.95))',
      warning: 'linear-gradient(135deg, rgba(245, 158, 11, 0.95), rgba(251, 191, 36, 0.95))',
      success: 'linear-gradient(135deg, rgba(34, 197, 94, 0.95), rgba(22, 163, 74, 0.95))',
      insight: 'linear-gradient(135deg, rgba(249, 115, 22, 0.95), rgba(245, 158, 11, 0.95))'
    };
    const icons = { info: 'ℹ️', warning: '⚠️', success: '✅', insight: '🎓' };

    insightEl.style.background = colors[insight.type];
    insightEl.style.color = 'white';
    insightEl.innerHTML = `<div style="display: flex; align-items: center; gap: 10px;"><span style="font-size: 18px;">${icons[insight.type]}</span><div style="flex: 1;"><div style="font-weight: bold; margin-bottom: 4px;">${insight.title}</div><div style="font-size: 12px; opacity: 0.95;">${insight.message}</div></div></div>`;

    insightEl.addEventListener('click', () => {
      insightEl.style.animation = 'slideOutRight 0.2s ease-in';
      setTimeout(() => { insightEl.remove(); this.activeInsights.delete(insight.id); }, 200);
    });

    this.insightsContainer.appendChild(insightEl);
    const duration = insight.duration || 6000;
    setTimeout(() => {
      if (insightEl.parentElement) {
        insightEl.style.animation = 'slideOutRight 0.2s ease-in';
        setTimeout(() => { insightEl.remove(); this.activeInsights.delete(insight.id); }, 200);
      }
    }, duration);
  }

  analyzeMarket(data: { mode: MarketMode; price: number; quantity: number; consumerSurplus: number; producerSurplus: number; buyerCount: number; sellerCount: number; }): void {
    const { mode, price, consumerSurplus, producerSurplus, buyerCount, sellerCount } = data;
    if (mode !== this.lastMode) { this.onModeChange(mode); this.lastMode = mode; }
    if (Math.abs(price - this.lastPrice) > 5 && this.lastPrice > 0) {
      if (price > this.lastPrice) {
        this.showInsight({ id: `price-increase-${Date.now()}`, title: 'Price Rising! 📈', message: `Market price increased to $${price.toFixed(2)}. ${buyerCount > sellerCount ? 'More buyers than sellers - demand exceeds supply!' : 'Sellers gaining market power!'}`, type: 'info', duration: 4000 });
      } else {
        this.showInsight({ id: `price-decrease-${Date.now()}`, title: 'Price Falling! 📉', message: `Market price dropped to $${price.toFixed(2)}. ${sellerCount > buyerCount ? 'More sellers than buyers - supply exceeds demand!' : 'Competition driving prices down!'}`, type: 'info', duration: 4000 });
      }
    }
    this.lastPrice = price;
    const totalSurplus = consumerSurplus + producerSurplus;
    if (totalSurplus > 1000 && mode === 'perfect') { this.showInsight({ id: 'high-efficiency', title: 'Market Efficiency! 🎯', message: `Total surplus: $${Math.round(totalSurplus)}. Perfect competition maximizes social welfare!`, type: 'success', duration: 5000 }); }
    if (Math.abs(buyerCount - sellerCount) > 30) { this.showInsight({ id: 'market-imbalance', title: 'Market Imbalance ⚖️', message: `${buyerCount > sellerCount ? 'Buyers' : 'Sellers'} outnumber the other side by ${Math.abs(buyerCount - sellerCount)}. This affects equilibrium!`, type: 'warning', duration: 5000 }); }
  }

  private onModeChange(mode: MarketMode): void {
    const exp = { perfect: { title: 'Perfect Competition', text: 'Many buyers and sellers, none can influence price. <strong>Price = Marginal Cost</strong>. This maximizes total surplus - the most efficient market structure!' }, monopoly: { title: 'Monopoly Power', text: 'Single seller controls the market! They restrict quantity to raise prices above marginal cost (<strong>P > MC</strong>). Watch consumer surplus shrink and deadweight loss appear! 📊' }, oligopoly: { title: 'Oligopoly', text: 'Few sellers can influence price through strategic behavior. Prices fall between monopoly and perfect competition. Watch for implicit coordination! 🤝' }, monopolistic: { title: 'Monopolistic Competition', text: 'Many sellers with <strong>differentiated products</strong>. Each has slight pricing power, but competition keeps prices reasonable. Brand loyalty matters here! 🏷️' } }[mode];
    this.showConcept(exp.title, exp.text, 7000);
    setTimeout(() => { this.showInsight({ id: `mode-${mode}`, title: '🎓 Economic Insight', message: this.getModeInsight(mode), type: 'insight', duration: 8000 }); }, 1000);
  }

  private getModeInsight(mode: MarketMode): string {
    return { perfect: 'In perfect competition, no single buyer or seller can influence price - they are "price takers." This leads to allocative efficiency!', monopoly: 'Monopolists produce where MR = MC, but charge price from the demand curve. The gap between P and MC is their market power.', oligopoly: 'Game theory applies here! Firms must consider rivals\' reactions. The Cournot model predicts quantity competition.', monopolistic: 'Product differentiation creates mini-monopolies. Firms face downward-sloping demand but competition limits profits.' }[mode];
  }

  showTradeInsight(price: number, buyerSurplus: number, sellerSurplus: number): void {
    if (Math.random() > 0.85) { this.showInsight({ id: `trade-${Date.now()}`, title: 'Trade Creates Value! 💰', message: `This trade at $${price.toFixed(2)} created $${(buyerSurplus + sellerSurplus).toFixed(2)} in total surplus. Both parties benefit - that's the magic of markets!`, type: 'success', duration: 4000 }); }
  }

  private injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `@keyframes slideInDown{from{transform:translate(-50%,-100%);opacity:0}to{transform:translate(-50%,0);opacity:1}}@keyframes slideOutUp{from{transform:translate(-50%,0);opacity:1}to{transform:translate(-50%,-100%);opacity:0}}@keyframes slideInRight{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideOutRight{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}`;
    document.head.appendChild(style);
  }

  destroy(): void {
    if (this.overlayElement && this.overlayElement.parentElement) { this.overlayElement.parentElement.removeChild(this.overlayElement); }
  }
}
