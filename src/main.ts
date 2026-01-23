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
let isPaused = false;

function togglePause(): void {
  isPaused = !isPaused;
  const pauseBtn = document.getElementById('pauseBtn');
  const statusDot = document.querySelector('.status-dot') as HTMLElement;
  const statusText = document.querySelector('.status') as HTMLElement;

  if (isPaused) {
    document.body.classList.add('paused');
    if (pauseBtn) {
      pauseBtn.innerHTML = '▶ Play';
      pauseBtn.classList.remove('primary');
    }
    if (statusDot) {
      statusDot.style.background = '#f59e0b';
      statusDot.style.boxShadow = '0 0 8px rgba(245, 158, 11, 0.6)';
    }
    if (statusText) {
      const dot = statusText.querySelector('.status-dot');
      statusText.innerHTML = '';
      if (dot) statusText.appendChild(dot);
      statusText.append('Paused');
    }
    game.scene.pause('MainScene');
  } else {
    document.body.classList.remove('paused');
    if (pauseBtn) {
      pauseBtn.innerHTML = '⏸ Pause';
      pauseBtn.classList.add('primary');
    }
    if (statusDot) {
      statusDot.style.background = '#22c55e';
      statusDot.style.boxShadow = '0 0 8px rgba(34, 197, 94, 0.6)';
    }
    if (statusText) {
      const dot = statusText.querySelector('.status-dot');
      statusText.innerHTML = '';
      if (dot) statusText.appendChild(dot);
      statusText.append('Market active');
    }
    game.scene.resume('MainScene');
  }
}

function resetSimulation(): void {
  // Reset market
  market.reset();

  // Restart scene
  game.scene.stop('MainScene');
  game.scene.start('MainScene', { market });

  // Reset pause state
  if (isPaused) {
    togglePause();
  }

  // Reset UI
  lastAveragePrice = 0;
  const priceEl = document.getElementById('marketPrice');
  const transEl = document.getElementById('transactionCount');
  const csEl = document.getElementById('consumerSurplus');
  const psEl = document.getElementById('producerSurplus');
  const dwlEl = document.getElementById('deadweightLoss');

  if (priceEl) priceEl.textContent = '$0.00';
  if (transEl) transEl.textContent = '0';
  if (csEl) csEl.textContent = '$0';
  if (psEl) psEl.textContent = '$0';
  if (dwlEl) dwlEl.textContent = '$0';
}

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

  // Speed preset buttons
  const speedButtons = document.querySelectorAll('.speed-btn');
  speedButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      const speed = parseFloat((e.target as HTMLElement).getAttribute('data-speed') || '1');
      mainScene.setTradeSpeed(speed);

      // Update active state
      speedButtons.forEach(btn => btn.classList.remove('active'));
      (e.target as HTMLElement).classList.add('active');
    });
  });

  // Pause/Play button
  const pauseBtn = document.getElementById('pauseBtn');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', togglePause);
  }

  // Reset button
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetSimulation);
  }

  // Keyboard shortcut: Spacebar for pause/play
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      togglePause();
    }
  });

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

      // Visual flash indicator
      const gameContainer = document.getElementById('game-container');
      if (gameContainer) {
        gameContainer.style.transition = 'box-shadow 0.3s ease';
        gameContainer.style.boxShadow = '0 0 40px rgba(153, 0, 0, 0.6), inset 0 0 80px rgba(255, 204, 0, 0.3)';
        setTimeout(() => {
          gameContainer.style.boxShadow = '';
        }, 600);
      }
    });
  });

  updateModeDisplay(market.getMarketState().mode);
}

// Update charts and education system periodically
setInterval(() => {
  if (isPaused) return; // Skip updates when paused

  const buyers = market.getBuyers();
  const sellers = market.getSellers();
  const state = market.getMarketState();

  chartManager.updateFromAgents(buyers, sellers);
  priceHistoryChart.addPrice(state.averagePrice);
  updateEquilibriumReadout();
  updateInsights();

  // Update stats display
  const priceEl = document.getElementById('marketPrice');
  const transEl = document.getElementById('transactionCount');
  const csEl = document.getElementById('consumerSurplus');
  const psEl = document.getElementById('producerSurplus');
  const dwlEl = document.getElementById('deadweightLoss');

  if (priceEl) priceEl.textContent = `$${state.averagePrice.toFixed(2)}`;
  if (transEl) transEl.textContent = state.totalTransactions.toString();
  if (csEl) csEl.textContent = `$${Math.round(state.consumerSurplus)}`;
  if (psEl) psEl.textContent = `$${Math.round(state.producerSurplus)}`;
  if (dwlEl) dwlEl.textContent = `$${Math.round(state.deadweightLoss)}`;

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
