/**
 * Main Phaser Game Scene
 * Handles sprite rendering, animations, and visual representation of economic activity
 * @author Dr. Ian Helfrich
 */

import Phaser from 'phaser';
import { Market } from '../engine/Market';
import { Buyer, Seller } from '../engine/Agent';
import type { MarketMode, TradeResult } from '../types';

export class MainScene extends Phaser.Scene {
  private market!: Market;
  private buyerSprites: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private sellerSprites: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private tradeSpeed: number = 1.0;
  private targetBuyerCount: number = 50;
  private targetSellerCount: number = 50;
  private marketTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super({ key: 'MainScene' });
  }

  init(data: { market: Market }) {
    this.market = data.market;
  }

  preload(): void {
    // Create a simple particle texture programmatically
    const graphics = this.add.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0xffd700, 1);
    graphics.fillCircle(4, 4, 4);
    graphics.generateTexture('particle', 8, 8);
    graphics.destroy();
  }

  /**
   * Create immersive market environment with zones
   */
  private createMarketEnvironment(): void {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    // Gradient background (sky to ground) - simplified for Phaser
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x87CEEB, 0x87CEEB, 0xC8E6C9, 0xC8E6C9, 1);
    bg.fillRect(0, 0, width, height);
    bg.setDepth(0);

    // Market floor (trading area)
    const floorY = 80;
    const floorHeight = height - 180;
    const floorPadding = 30;
    const floorWidth = width - floorPadding * 2;

    // Trading floor background
    const floor = this.add.graphics();
    floor.fillStyle(0xFFF8E1, 0.7); // Warm cream
    floor.fillRoundedRect(floorPadding, floorY, floorWidth, floorHeight, 10);
    floor.lineStyle(3, 0xD4AF37, 1); // Gold border
    floor.strokeRoundedRect(floorPadding, floorY, floorWidth, floorHeight, 10);
    floor.setDepth(1);

    // Buyer zone (left side)
    const buyerZone = this.add.graphics();
    buyerZone.fillStyle(0x4a90e2, 0.12);
    const zoneGap = 20;
    const zoneInset = 10;
    const zoneWidth = (floorWidth - zoneGap) / 2;
    const buyerZoneX = floorPadding;
    buyerZone.fillRoundedRect(buyerZoneX + zoneInset, floorY + 10, zoneWidth - zoneInset * 2, floorHeight - 20, 8);
    buyerZone.lineStyle(2, 0x4a90e2, 0.5);
    buyerZone.strokeRoundedRect(buyerZoneX + zoneInset, floorY + 10, zoneWidth - zoneInset * 2, floorHeight - 20, 8);
    buyerZone.setDepth(2);

    const buyerLabel = this.add.text(
      buyerZoneX + zoneWidth / 2,
      floorY + 30,
      'BUYER ZONE',
      {
        fontSize: '16px',
        color: '#2c5aa0',
        fontFamily: 'Space Grotesk, Segoe UI, sans-serif',
        fontStyle: 'bold'
      }
    );
    buyerLabel.setOrigin(0.5, 0.5);
    buyerLabel.setDepth(3);
    buyerLabel.setAlpha(0.6);

    // Seller zone (right side)
    const sellerZone = this.add.graphics();
    const sellerX = buyerZoneX + zoneWidth + zoneGap;
    sellerZone.fillStyle(0x50c878, 0.12);
    sellerZone.fillRoundedRect(sellerX + zoneInset, floorY + 10, zoneWidth - zoneInset * 2, floorHeight - 20, 8);
    sellerZone.lineStyle(2, 0x50c878, 0.5);
    sellerZone.strokeRoundedRect(sellerX + zoneInset, floorY + 10, zoneWidth - zoneInset * 2, floorHeight - 20, 8);
    sellerZone.setDepth(2);

    const sellerLabel = this.add.text(
      sellerX + zoneWidth / 2,
      floorY + 30,
      'SELLER ZONE',
      {
        fontSize: '16px',
        color: '#2d7a4d',
        fontFamily: 'Space Grotesk, Segoe UI, sans-serif',
        fontStyle: 'bold'
      }
    );
    sellerLabel.setOrigin(0.5, 0.5);
    sellerLabel.setDepth(3);
    sellerLabel.setAlpha(0.6);

    // Central trading line
    const centerX = floorPadding + floorWidth / 2;
    const tradeLine = this.add.graphics();
    tradeLine.lineStyle(2, 0xFFD700, 1);
    tradeLine.setAlpha(0.5);
    for (let y = floorY + 20; y < floorY + floorHeight - 20; y += 20) {
      tradeLine.lineBetween(centerX, y, centerX, y + 10);
    }
    tradeLine.setDepth(2);

    // Market stalls decoration (optional)
    this.createMarketStalls(floorPadding + 10, floorY + floorHeight - 80, zoneWidth - 40);
  }

  private getZoneBounds(): {
    buyer: { xMin: number; xMax: number };
    seller: { xMin: number; xMax: number };
    yMin: number;
    yMax: number;
  } {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    const floorY = 80;
    const floorHeight = height - 180;
    const floorPadding = 30;
    const floorWidth = width - floorPadding * 2;
    const zoneGap = 20;
    const zoneInset = 20;
    const zoneWidth = (floorWidth - zoneGap) / 2;

    const buyerXMin = floorPadding + zoneInset;
    const buyerXMax = buyerXMin + zoneWidth - zoneInset * 2;
    const sellerXMin = floorPadding + zoneWidth + zoneGap + zoneInset;
    const sellerXMax = sellerXMin + zoneWidth - zoneInset * 2;

    return {
      buyer: { xMin: buyerXMin, xMax: buyerXMax },
      seller: { xMin: sellerXMin, xMax: sellerXMax },
      yMin: floorY + 20,
      yMax: floorY + floorHeight - 20
    };
  }

  /**
   * Create decorative market stalls
   */
  private createMarketStalls(x: number, y: number, spacing: number): void {
    for (let i = 0; i < 3; i++) {
      const stall = this.add.graphics();
      const stallX = x + i * (spacing / 3) + 50;

      // Stall roof
      stall.fillStyle(0xD84315, 1);
      stall.fillTriangle(stallX, y - 20, stallX + 30, y - 20, stallX + 15, y - 35);

      // Stall counter
      stall.fillStyle(0x8B4513, 1);
      stall.fillRect(stallX, y, 30, 15);

      stall.setDepth(5);
      stall.setAlpha(0.3);
    }
  }

  create(): void {
    this.createMarketEnvironment();

    // Add title with shadow
    const titleText = this.add.text(
      this.cameras.main.width / 2,
      30,
      'EconGames - Interactive Microeconomics',
      {
        fontSize: '24px',
        color: '#fff',
        fontFamily: 'Fraunces, serif',
        fontStyle: 'bold',
        stroke: '#333',
        strokeThickness: 3,
        shadow: {
          offsetX: 2,
          offsetY: 2,
          color: '#00000080',
          blur: 4,
          fill: true
        }
      }
    );
    titleText.setOrigin(0.5, 0.5);
    titleText.setDepth(1000);

    // Spawn initial agents
    this.spawnAgents();

    // Set up market clearing on interval
    this.marketTimer = this.time.addEvent({
      delay: 1000 / this.tradeSpeed,
      callback: this.updateMarket,
      callbackScope: this,
      loop: true
    });

    // Update sprite positions
    this.time.addEvent({
      delay: 50,
      callback: this.updateSpritePositions,
      callbackScope: this,
      loop: true
    });
  }

  update(): void {
    // Maintain target agent counts
    this.maintainAgentCounts();
  }

  private spawnAgents(): void {
    const bounds = this.getZoneBounds();

    // Spawn buyers
    for (let i = 0; i < this.targetBuyerCount; i++) {
      const buyer = new Buyer({
        id: `buyer-${Date.now()}-${i}`,
        type: 'buyer',
        reservationPrice: 30 + Math.random() * 70, // $30-$100
        budget: 50 + Math.random() * 150, // $50-$200
        inventory: 0,
        utilityFunction: (q) => Math.sqrt(q) * 100 - q * 5
      });

      buyer.position = {
        x: bounds.buyer.xMin + Math.random() * (bounds.buyer.xMax - bounds.buyer.xMin),
        y: bounds.yMin + Math.random() * (bounds.yMax - bounds.yMin)
      };
      buyer.velocity = {
        x: (Math.random() - 0.5) * 2,
        y: (Math.random() - 0.5) * 2
      };

      this.market.addBuyer(buyer);
      this.createBuyerSprite(buyer);
    }

    // Spawn sellers
    for (let i = 0; i < this.targetSellerCount; i++) {
      const seller = new Seller({
        id: `seller-${Date.now()}-${i}`,
        type: 'seller',
        reservationPrice: 20 + Math.random() * 50, // $20-$70
        budget: 0,
        inventory: 5 + Math.floor(Math.random() * 15), // 5-20 units
        costFunction: (q) => q * q * 2 + 10 * q
      });

      seller.position = {
        x: bounds.seller.xMin + Math.random() * (bounds.seller.xMax - bounds.seller.xMin),
        y: bounds.yMin + Math.random() * (bounds.yMax - bounds.yMin)
      };
      seller.velocity = {
        x: (Math.random() - 0.5) * 2,
        y: (Math.random() - 0.5) * 2
      };

      this.market.addSeller(seller);
      this.createSellerSprite(seller);
    }
  }

  private createBuyerSprite(buyer: Buyer): void {
    const sprite = this.add.graphics();

    // Shadow
    sprite.fillStyle(0x000000, 0.2);
    sprite.fillEllipse(0, 14, 14, 5);

    // Draw cute buyer sprite (blue circle with eyes) - enhanced
    sprite.fillStyle(0x4a90e2, 1);
    sprite.fillCircle(0, 0, 13);

    // Outer glow
    sprite.lineStyle(2, 0x7abaff, 0.4);
    sprite.strokeCircle(0, 0, 14);

    // Eyes (larger, more expressive)
    sprite.fillStyle(0xffffff, 1);
    sprite.fillCircle(-5, -4, 4);
    sprite.fillCircle(5, -4, 4);

    // Pupils (animated later)
    sprite.fillStyle(0x000000, 1);
    sprite.fillCircle(-5, -4, 2);
    sprite.fillCircle(5, -4, 2);

    // Sparkle in eyes
    sprite.fillStyle(0xffffff, 0.9);
    sprite.fillCircle(-4, -5, 1);
    sprite.fillCircle(6, -5, 1);

    // Smile (happier)
    sprite.lineStyle(2, 0x000000, 1);
    sprite.beginPath();
    sprite.arc(0, 3, 7, 0.3, Math.PI - 0.3);
    sprite.strokePath();

    // Rosy cheeks
    sprite.fillStyle(0xff9999, 0.4);
    sprite.fillCircle(-8, 1, 3);
    sprite.fillCircle(8, 1, 3);

    sprite.setPosition(buyer.position.x, buyer.position.y);
    sprite.setDepth(10);

    // Add idle bobbing animation
    this.tweens.add({
      targets: sprite,
      y: buyer.position.y + 2,
      duration: 1000 + Math.random() * 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    this.buyerSprites.set(buyer.id, sprite);
  }

  private createSellerSprite(seller: Seller): void {
    const sprite = this.add.graphics();

    // Shadow
    sprite.fillStyle(0x000000, 0.2);
    sprite.fillEllipse(0, 16, 16, 5);

    // Draw cute seller sprite (green square with eyes) - enhanced
    sprite.fillStyle(0x50c878, 1);
    sprite.fillRoundedRect(-13, -13, 26, 26, 5);

    // Outer glow
    sprite.lineStyle(2, 0x80e8a8, 0.4);
    sprite.strokeRoundedRect(-14, -14, 28, 28, 5);

    // Hat/shop indicator (small roof)
    sprite.fillStyle(0x8B4513, 1);
    sprite.fillTriangle(-10, -13, 10, -13, 0, -20);
    sprite.lineStyle(1, 0x654321, 1);
    sprite.strokeTriangle(-10, -13, 10, -13, 0, -20);

    // Eyes (larger, more expressive)
    sprite.fillStyle(0xffffff, 1);
    sprite.fillCircle(-6, -6, 4);
    sprite.fillCircle(6, -6, 4);

    // Pupils
    sprite.fillStyle(0x000000, 1);
    sprite.fillCircle(-6, -6, 2);
    sprite.fillCircle(6, -6, 2);

    // Sparkle in eyes
    sprite.fillStyle(0xffffff, 0.9);
    sprite.fillCircle(-5, -7, 1);
    sprite.fillCircle(7, -7, 1);

    // Smile (friendly merchant)
    sprite.lineStyle(2, 0x000000, 1);
    sprite.beginPath();
    sprite.arc(0, 4, 7, 0.3, Math.PI - 0.3);
    sprite.strokePath();

    // Rosy cheeks
    sprite.fillStyle(0xff9999, 0.4);
    sprite.fillCircle(-10, 2, 3);
    sprite.fillCircle(10, 2, 3);

    sprite.setPosition(seller.position.x, seller.position.y);
    sprite.setDepth(10);

    // Add idle rotation animation
    this.tweens.add({
      targets: sprite,
      angle: 3,
      duration: 1200 + Math.random() * 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    this.sellerSprites.set(seller.id, sprite);
  }

  private updateSpritePositions(): void {
    const bounds = this.getZoneBounds();

    // Update buyers
    for (const buyer of this.market.getBuyers()) {
      // Bounce off walls
      if (buyer.position.x < bounds.buyer.xMin || buyer.position.x > bounds.buyer.xMax) {
        buyer.velocity.x *= -1;
      }
      if (buyer.position.y < bounds.yMin || buyer.position.y > bounds.yMax) {
        buyer.velocity.y *= -1;
      }

      // Update position
      buyer.position.x += buyer.velocity.x;
      buyer.position.y += buyer.velocity.y;

      // Update sprite
      const sprite = this.buyerSprites.get(buyer.id);
      if (sprite) {
        sprite.setPosition(buyer.position.x, buyer.position.y);

        // Pulse effect when trading
        if (buyer.isTrading) {
          sprite.setScale(1.3);
          this.time.delayedCall(200, () => {
            sprite.setScale(1.0);
            buyer.isTrading = false;
          });
        }
      }
    }

    // Update sellers
    for (const seller of this.market.getSellers()) {
      // Bounce off walls
      if (seller.position.x < bounds.seller.xMin || seller.position.x > bounds.seller.xMax) {
        seller.velocity.x *= -1;
      }
      if (seller.position.y < bounds.yMin || seller.position.y > bounds.yMax) {
        seller.velocity.y *= -1;
      }

      // Update position
      seller.position.x += seller.velocity.x;
      seller.position.y += seller.velocity.y;

      // Update sprite
      const sprite = this.sellerSprites.get(seller.id);
      if (sprite) {
        sprite.setPosition(seller.position.x, seller.position.y);

        // Pulse effect when trading
        if (seller.isTrading) {
          sprite.setScale(1.3);
          this.time.delayedCall(200, () => {
            sprite.setScale(1.0);
            seller.isTrading = false;
          });
        }
      }
    }
  }

  private updateMarket(): void {
    const trades = this.market.clearMarket();

    // Visualize trades
    for (const trade of trades) {
      this.visualizeTrade(trade);
    }

    // Update stats in UI
    this.updateUI();
  }

  private visualizeTrade(trade: TradeResult): void {
    const buyerSprite = this.buyerSprites.get(trade.buyerId);
    const sellerSprite = this.sellerSprites.get(trade.sellerId);

    if (!buyerSprite || !sellerSprite) return;

    const buyer = this.market.getBuyers().find(b => b.id === trade.buyerId);
    const seller = this.market.getSellers().find(s => s.id === trade.sellerId);

    if (!buyer || !seller) return;

    // Mark as trading
    buyer.isTrading = true;
    seller.isTrading = true;

    // Draw line between buyer and seller
    const line = this.add.graphics();
    line.lineStyle(2, 0xffd700, 1);
    line.beginPath();
    line.moveTo(buyer.position.x, buyer.position.y);
    line.lineTo(seller.position.x, seller.position.y);
    line.strokePath();

    // Show price with surplus info
    const surplusTotal = trade.buyerSurplus + trade.sellerSurplus;
    const priceText = this.add.text(
      (buyer.position.x + seller.position.x) / 2,
      (buyer.position.y + seller.position.y) / 2,
      `$${trade.price.toFixed(2)}\n+$${surplusTotal.toFixed(1)} surplus`,
      {
        fontSize: '13px',
        color: '#f97316',
        fontFamily: 'Space Grotesk, Segoe UI, sans-serif',
        fontStyle: 'bold',
        backgroundColor: '#ffffff',
        padding: { x: 6, y: 3 },
        align: 'center'
      }
    );
    priceText.setOrigin(0.5, 0.5);

    // Fade out
    this.tweens.add({
      targets: [line, priceText],
      alpha: 0,
      duration: 1000,
      onComplete: () => {
        line.destroy();
        priceText.destroy();
      }
    });

    // Particle effect
    this.createTradeParticles(
      (buyer.position.x + seller.position.x) / 2,
      (buyer.position.y + seller.position.y) / 2
    );
  }

  private createTradeParticles(x: number, y: number): void {
    const particles = this.add.particles(x, y, 'particle', {
      speed: { min: 50, max: 150 },
      scale: { start: 0.5, end: 0 },
      lifespan: 500,
      quantity: 10,
      blendMode: 'ADD'
    });

    this.time.delayedCall(500, () => {
      particles.destroy();
    });
  }

  private maintainAgentCounts(): void {
    const currentBuyers = this.market.getBuyers().length;
    const currentSellers = this.market.getSellers().length;

    // Add buyers if needed
    if (currentBuyers < this.targetBuyerCount) {
      const diff = this.targetBuyerCount - currentBuyers;
      const bounds = this.getZoneBounds();
      for (let i = 0; i < diff; i++) {
        const buyer = new Buyer({
          id: `buyer-${Date.now()}-${i}`,
          type: 'buyer',
          reservationPrice: 30 + Math.random() * 70,
          budget: 50 + Math.random() * 150,
          inventory: 0,
          utilityFunction: (q) => Math.sqrt(q) * 100 - q * 5
        });

        buyer.position = {
          x: bounds.buyer.xMin + Math.random() * (bounds.buyer.xMax - bounds.buyer.xMin),
          y: bounds.yMin + Math.random() * (bounds.yMax - bounds.yMin)
        };
        buyer.velocity = {
          x: (Math.random() - 0.5) * 2,
          y: (Math.random() - 0.5) * 2
        };

        this.market.addBuyer(buyer);
        this.createBuyerSprite(buyer);
      }
    }

    // Remove buyers if needed
    if (currentBuyers > this.targetBuyerCount) {
      const diff = currentBuyers - this.targetBuyerCount;
      const buyers = this.market.getBuyers();
      for (let i = 0; i < diff && i < buyers.length; i++) {
        const buyer = buyers[i];
        const sprite = this.buyerSprites.get(buyer.id);
        if (sprite) {
          sprite.destroy();
          this.buyerSprites.delete(buyer.id);
        }
        this.market.removeBuyer(buyer.id);
      }
    }

    // Add sellers if needed
    if (currentSellers < this.targetSellerCount) {
      const diff = this.targetSellerCount - currentSellers;
      const bounds = this.getZoneBounds();
      for (let i = 0; i < diff; i++) {
        const seller = new Seller({
          id: `seller-${Date.now()}-${i}`,
          type: 'seller',
          reservationPrice: 20 + Math.random() * 50,
          budget: 0,
          inventory: 5 + Math.floor(Math.random() * 15),
          costFunction: (q) => q * q * 2 + 10 * q
        });

        seller.position = {
          x: bounds.seller.xMin + Math.random() * (bounds.seller.xMax - bounds.seller.xMin),
          y: bounds.yMin + Math.random() * (bounds.yMax - bounds.yMin)
        };
        seller.velocity = {
          x: (Math.random() - 0.5) * 2,
          y: (Math.random() - 0.5) * 2
        };

        this.market.addSeller(seller);
        this.createSellerSprite(seller);
      }
    }

    // Remove sellers if needed
    if (currentSellers > this.targetSellerCount) {
      const diff = currentSellers - this.targetSellerCount;
      const sellers = this.market.getSellers();
      for (let i = 0; i < diff && i < sellers.length; i++) {
        const seller = sellers[i];
        const sprite = this.sellerSprites.get(seller.id);
        if (sprite) {
          sprite.destroy();
          this.sellerSprites.delete(seller.id);
        }
        this.market.removeSeller(seller.id);
      }
    }
  }

  private updateUI(): void {
    const state = this.market.getMarketState();

    // Update DOM elements
    const marketPriceEl = document.getElementById('marketPrice');
    const transactionCountEl = document.getElementById('transactionCount');
    const consumerSurplusEl = document.getElementById('consumerSurplus');
    const producerSurplusEl = document.getElementById('producerSurplus');
    const deadweightLossEl = document.getElementById('deadweightLoss');

    if (marketPriceEl) marketPriceEl.textContent = `$${state.averagePrice.toFixed(2)}`;
    if (transactionCountEl) transactionCountEl.textContent = state.totalTransactions.toString();
    if (consumerSurplusEl) consumerSurplusEl.textContent = `$${Math.round(state.consumerSurplus)}`;
    if (producerSurplusEl) producerSurplusEl.textContent = `$${Math.round(state.producerSurplus)}`;
    if (deadweightLossEl) deadweightLossEl.textContent = `$${Math.round(state.deadweightLoss)}`;
  }

  // Public methods for UI controls
  public setTargetBuyerCount(count: number): void {
    this.targetBuyerCount = count;
  }

  public setTargetSellerCount(count: number): void {
    this.targetSellerCount = count;
  }

  public setTradeSpeed(speed: number): void {
    this.tradeSpeed = speed;
    if (this.marketTimer) {
      this.marketTimer.remove(false);
      this.marketTimer = this.time.addEvent({
        delay: 1000 / this.tradeSpeed,
        callback: this.updateMarket,
        callbackScope: this,
        loop: true
      });
    }
  }

  public setMarketMode(mode: MarketMode): void {
    this.market.setMode(mode);
  }
}
