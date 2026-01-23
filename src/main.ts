/**
 * EconGames - Interactive Microeconomics Simulator
 * Main entry point
 * @author Dr. Ian Helfrich
 */

import Phaser from 'phaser';
import { Market } from './engine/Market';
import { MainScene } from './game/MainScene';
import { ChartManager } from './ui/ChartManager';
import { TooltipManager } from './ui/TooltipManager';
import { EducationOverlay } from './ui/EducationOverlay';
import { PriceHistoryChart } from './ui/PriceHistoryChart';
import type { MarketMode } from './types';

// Initialize the market
const market = new Market('perfect');

const modeLabels: Record<MarketMode, string> = {
  perfect: 'Perfect Competition',
  monopoly: 'Monopoly',
  oligopoly: 'Oligopoly',
  monopolistic: 'Monopolistic Competition'
};

const modeNarration: Record<MarketMode, string> = {
  perfect: 'Competitive pressure keeps prices close to equilibrium, maximizing total surplus.',
  monopoly: 'A single seller restricts output, raising price and increasing deadweight loss.',
  oligopoly: 'A few strategic sellers soften competition, pushing price above equilibrium.',
  monopolistic: 'Product differentiation lets sellers add a small markup over competitive prices.'
};

// Phaser game configuration
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1200,
  height: 700,
  parent: 'game-container',
  backgroundColor: '#f8fafc',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: MainScene,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false
    }
  }
};

// Create Phaser game
const game = new Phaser.Game(config);

// Pass market to scene after fonts are ready for crisp text rendering
const startScene = () => game.scene.start('MainScene', { market });
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(startScene).catch(startScene);
} else {
  startScene();
}

// Initialize Chart, Tooltip, Education, and History
const chartManager = new ChartManager('economicChart');
const tooltipManager = new TooltipManager();
const educationOverlay = new EducationOverlay();
const priceHistoryChart = new PriceHistoryChart('priceHistoryChart');

let lastAveragePrice = 0;

function updateModeDisplay(mode: MarketMode): void {
  const modeLabel = document.getElementById('marketModeLabel');
  const modePill = document.getElementById('modePill');

  if (modeLabel) {
    modeLabel.textContent = `Mode: ${modeLabels[mode]}`;
  }
  if (modePill) {
    modePill.textContent = modeLabels[mode];
  }
}

function updateEquilibriumReadout(): void {
  const eq = chartManager.getEquilibriumPoint();
  const eqEl = document.getElementById('equilibriumReadout');
  if (!eqEl) return;

  if (!eq) {
    eqEl.textContent = 'Equilibrium: collecting trades…';
    return;
  }

  eqEl.textContent = `Equilibrium (chart): P=$${eq.p.toFixed(2)} · Q=${eq.q}`;
}

function updateInsights(): void {
  const state = market.getMarketState();
  const insightEl = document.getElementById('insightText');
  if (!insightEl) return;

  if (state.totalTransactions === 0) {
    insightEl.textContent = 'Markets are warming up — once trades start, you’ll see surplus and equilibrium move in real time.';
    lastAveragePrice = state.averagePrice;
    return;
  }

  const eq = chartManager.getEquilibriumPoint();
  const priceDelta = state.averagePrice - lastAveragePrice;
  const priceTrend = Math.abs(priceDelta) < 0.5
    ? 'stable'
    : priceDelta > 0
      ? 'rising'
      : 'falling';

  const eqGap = eq ? state.averagePrice - eq.p : 0;
  const eqDirection = eq
    ? eqGap > 1
      ? 'above'
      : eqGap < -1
        ? 'below'
        : 'near'
    : 'near';

  const trendSentence = priceTrend === 'stable'
    ? 'Price is steady this round.'
    : `Price is ${priceTrend} this round.`;

  const eqSentence = eq
    ? `Average price is ${eqDirection} the chart equilibrium.`
    : 'Equilibrium will appear once enough trades form the curves.';

  const dwlSentence = state.deadweightLoss > 0
    ? `Deadweight loss is estimated at $${Math.round(state.deadweightLoss)}.`
    : 'Deadweight loss is near zero in competitive markets.';

  insightEl.textContent = `${modeNarration[state.mode]} ${trendSentence} ${eqSentence} ${dwlSentence}`;
  lastAveragePrice = state.averagePrice;
}

// Set up UI controls
function setupControls(): void {
  const mainScene = game.scene.getScene('MainScene') as MainScene;

  // Buyers slider
  const numBuyersSlider = document.getElementById('numBuyers') as HTMLInputElement;
  const numBuyersValue = document.getElementById('numBuyersValue');
  if (numBuyersSlider && numBuyersValue) {
    numBuyersSlider.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value);
      numBuyersValue.textContent = value.toString();
      mainScene.setTargetBuyerCount(value);
    });
  }

  // Sellers slider
  const numSellersSlider = document.getElementById('numSellers') as HTMLInputElement;
  const numSellersValue = document.getElementById('numSellersValue');
  if (numSellersSlider && numSellersValue) {
    numSellersSlider.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value);
      numSellersValue.textContent = value.toString();
      mainScene.setTargetSellerCount(value);
    });
  }

  // Trade speed slider
  const tradeSpeedSlider = document.getElementById('tradeSpeed') as HTMLInputElement;
  const tradeSpeedValue = document.getElementById('tradeSpeedValue');
  if (tradeSpeedSlider && tradeSpeedValue) {
    tradeSpeedSlider.addEventListener('input', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      tradeSpeedValue.textContent = `${value.toFixed(1)}x`;
      mainScene.setTradeSpeed(value);
    });
  }

  // Market mode buttons
  const modeButtons = document.querySelectorAll('.mode-btn');
  modeButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      const mode = (e.target as HTMLElement).getAttribute('data-mode') as MarketMode;

      // Update active state
      modeButtons.forEach(btn => btn.classList.remove('active'));
      (e.target as HTMLElement).classList.add('active');

      // Update market
      mainScene.setMarketMode(mode);
      market.setMode(mode);
      updateModeDisplay(mode);
    });
  });

  updateModeDisplay(market.getMarketState().mode);
}

// Update charts and education system periodically
setInterval(() => {
  const buyers = market.getBuyers();
  const sellers = market.getSellers();
  const state = market.getMarketState();

  chartManager.updateFromAgents(buyers, sellers);
  priceHistoryChart.addPrice(state.averagePrice);
  updateEquilibriumReadout();
  updateInsights();

  educationOverlay.analyzeMarket({
    mode: state.mode,
    price: state.averagePrice,
    quantity: state.equilibriumQuantity,
    consumerSurplus: state.consumerSurplus,
    producerSurplus: state.producerSurplus,
    buyerCount: buyers.length,
    sellerCount: sellers.length
  });
}, 500);

// Initialize controls when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupControls);
} else {
  setupControls();
}

// Add hover detection for tooltips
const gameContainer = document.getElementById('game-container');
if (gameContainer) {
  gameContainer.addEventListener('mousemove', (e) => {
    const rect = gameContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if hovering over any agent
    let foundAgent = false;

    for (const buyer of market.getBuyers()) {
      const dx = x - buyer.position.x;
      const dy = y - buyer.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 15) {
        tooltipManager.showBuyerTooltip(buyer, e.clientX, e.clientY);
        foundAgent = true;
        break;
      }
    }

    if (!foundAgent) {
      for (const seller of market.getSellers()) {
        const dx = x - seller.position.x;
        const dy = y - seller.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 15) {
          tooltipManager.showSellerTooltip(seller, e.clientX, e.clientY);
          foundAgent = true;
          break;
        }
      }
    }

    if (!foundAgent) {
      tooltipManager.hide();
    }
  });

  gameContainer.addEventListener('mouseleave', () => {
    tooltipManager.hide();
  });
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  chartManager.destroy();
  tooltipManager.destroy();
  educationOverlay.destroy();
  priceHistoryChart.destroy();
  game.destroy(true);
});

// Export for debugging
(window as any).market = market;
(window as any).game = game;
