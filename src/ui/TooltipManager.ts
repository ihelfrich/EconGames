/**
 * Tooltip Manager for Educational Overlays
 * Shows agent information on hover
 * @author Dr. Ian Helfrich
 */

import type { Buyer, Seller } from '../engine/Agent';

export class TooltipManager {
  private tooltipElement: HTMLDivElement;

  constructor() {
    // Create tooltip DOM element
    this.tooltipElement = document.createElement('div');
    this.tooltipElement.id = 'agent-tooltip';
    this.tooltipElement.style.position = 'absolute';
    this.tooltipElement.style.display = 'none';
    this.tooltipElement.style.background = 'rgba(15, 23, 42, 0.92)';
    this.tooltipElement.style.color = 'white';
    this.tooltipElement.style.padding = '10px 12px';
    this.tooltipElement.style.borderRadius = '8px';
    this.tooltipElement.style.fontSize = '13px';
    this.tooltipElement.style.fontFamily = 'Space Grotesk, Segoe UI, sans-serif';
    this.tooltipElement.style.pointerEvents = 'none';
    this.tooltipElement.style.zIndex = '10000';
    this.tooltipElement.style.boxShadow = '0 12px 30px rgba(15, 23, 42, 0.35)';
    this.tooltipElement.style.minWidth = '180px';
    this.tooltipElement.style.lineHeight = '1.5';

    document.body.appendChild(this.tooltipElement);
  }

  showBuyerTooltip(buyer: Buyer, x: number, y: number): void {
    const budget = buyer['budget'] || 0;
    const quantityOwned = buyer.getQuantityOwned ? buyer.getQuantityOwned() : 0;
    const wtp = buyer.getWillingnessToPay();

    this.tooltipElement.innerHTML = `
      <div style="font-weight: bold; color: #4a90e2; margin-bottom: 6px; border-bottom: 1px solid rgba(74, 144, 226, 0.5); padding-bottom: 4px;">
        🔵 BUYER
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
        <span style="color: #aaa;">Budget:</span>
        <span style="font-weight: bold;">$${budget.toFixed(2)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
        <span style="color: #aaa;">Willing to Pay:</span>
        <span style="font-weight: bold; color: #4a90e2;">$${wtp.toFixed(2)}</span>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span style="color: #aaa;">Items Owned:</span>
        <span style="font-weight: bold;">${quantityOwned}</span>
      </div>
      <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 11px; color: #888; font-style: italic;">
        ${wtp > 0 ? 'Ready to buy' : 'Out of budget'}
      </div>
    `;

    this.showAt(x, y);
  }

  showSellerTooltip(seller: Seller, x: number, y: number): void {
    const inventory = seller['inventory'] || 0;
    const quantitySold = seller.getQuantitySold ? seller.getQuantitySold() : 0;
    const wta = seller.getWillingnessToPay(); // For sellers, this is WTA

    this.tooltipElement.innerHTML = `
      <div style="font-weight: bold; color: #50c878; margin-bottom: 6px; border-bottom: 1px solid rgba(80, 200, 120, 0.5); padding-bottom: 4px;">
        🟩 SELLER
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
        <span style="color: #aaa;">Inventory:</span>
        <span style="font-weight: bold;">${inventory} units</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
        <span style="color: #aaa;">Min. Price:</span>
        <span style="font-weight: bold; color: #50c878;">$${wta.toFixed(2)}</span>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span style="color: #aaa;">Units Sold:</span>
        <span style="font-weight: bold;">${quantitySold}</span>
      </div>
      <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 11px; color: #888; font-style: italic;">
        ${inventory > 0 ? 'Ready to sell' : 'Out of stock'}
      </div>
    `;

    this.showAt(x, y);
  }

  private showAt(x: number, y: number): void {
    this.tooltipElement.style.display = 'block';
    this.tooltipElement.style.left = `${x + 15}px`;
    this.tooltipElement.style.top = `${y - 10}px`;
  }

  hide(): void {
    this.tooltipElement.style.display = 'none';
  }

  destroy(): void {
    if (this.tooltipElement.parentNode) {
      this.tooltipElement.parentNode.removeChild(this.tooltipElement);
    }
  }
}
