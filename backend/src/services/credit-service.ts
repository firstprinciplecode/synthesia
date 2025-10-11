import { db } from '../db/index.js';
import { wallets, transactions, creditRequests, agents, actors } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export type OwnerType = 'USER' | 'AGENT';
export type TransactionType = 'ALLOCATE' | 'SPEND' | 'TRANSFER' | 'RECLAIM' | 'INITIAL' | 'EARN';
export type WalletStatus = 'ACTIVE' | 'FROZEN';

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// Token pricing per 1M tokens (in credits)
const TOKEN_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
};

const MARKUP_PERCENTAGE = 0.20; // 20% markup

export class CreditService {
  /**
   * Initialize a wallet for a user or agent
   */
  async initializeWallet(ownerId: string, ownerType: OwnerType): Promise<string> {
    const walletId = randomUUID();
    const initialBalance = ownerType === 'USER' ? '10000.00' : '0.00';

    await db.insert(wallets).values({
      id: walletId,
      ownerId,
      ownerType,
      balance: initialBalance,
      lifetimeEarned: ownerType === 'USER' ? '10000.00' : '0.00',
      lifetimeSpent: '0.00',
      status: 'ACTIVE',
    });

    // Log initial transaction for users
    if (ownerType === 'USER') {
      await db.insert(transactions).values({
        id: randomUUID(),
        fromWalletId: null,
        toWalletId: walletId,
        amount: '10000.00',
        transactionType: 'INITIAL',
        status: 'COMPLETED',
        reason: 'Initial signup bonus',
      });
    }

    return walletId;
  }

  /**
   * Get or create wallet for an owner
   */
  async getOrCreateWallet(ownerId: string, ownerType: OwnerType): Promise<any> {
    console.log('[credit-service] 🔍 getOrCreateWallet called for:', ownerId, ownerType);
    const existing = await db
      .select()
      .from(wallets)
      .where(and(eq(wallets.ownerId, ownerId), eq(wallets.ownerType, ownerType)))
      .limit(1);

    if (existing.length > 0) {
      console.log('[credit-service] ✅ Found existing wallet:', {
        id: existing[0].id,
        ownerId: existing[0].ownerId,
        balance: existing[0].balance,
        lifetimeSpent: existing[0].lifetimeSpent,
        lifetimeEarned: existing[0].lifetimeEarned
      });
      return existing[0];
    }

    console.log('[credit-service] 🆕 Creating new wallet for:', ownerId);
    const walletId = await this.initializeWallet(ownerId, ownerType);
    const newWallet = await db.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
    console.log('[credit-service] ✅ New wallet created:', {
      id: newWallet[0].id,
      ownerId: newWallet[0].ownerId,
      balance: newWallet[0].balance
    });
    return newWallet[0];
  }

  /**
   * Get balance for an owner
   */
  async getBalance(ownerId: string, ownerType: OwnerType): Promise<number> {
    const wallet = await this.getOrCreateWallet(ownerId, ownerType);
    return parseFloat(wallet.balance);
  }

  /**
   * Calculate cost for a message based on token usage
   */
  calculateMessageCost(tokenUsage: TokenUsage): number {
    const { inputTokens, outputTokens, model } = tokenUsage;
    
    // Default pricing if model not found
    const pricing = TOKEN_PRICING[model] || { input: 1.0, output: 3.0 };
    
    // Calculate base cost (per million tokens)
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    const baseCost = inputCost + outputCost;
    
    // Add 20% markup
    const finalCost = baseCost * (1 + MARKUP_PERCENTAGE);
    
    // Minimum charge of 0.01 credits (1 cent) per message
    const withMinimum = Math.max(0.01, finalCost);
    
    // Round to 2 decimal places
    return Math.round(withMinimum * 100) / 100;
  }

  /**
   * Allocate credits from user to agent
   */
  async allocateToAgent(userId: string, agentId: string, amount: number): Promise<{ success: boolean; error?: string; transactionId?: string }> {
    try {
      return await db.transaction(async (tx) => {
        // Get user wallet
        const userWallets = await tx
          .select()
          .from(wallets)
          .where(and(eq(wallets.ownerId, userId), eq(wallets.ownerType, 'USER')))
          .limit(1);

        if (userWallets.length === 0) {
          return { success: false, error: 'User wallet not found' };
        }

        const userWallet = userWallets[0];
        const currentBalance = parseFloat(userWallet.balance);

        if (currentBalance < amount) {
          return { success: false, error: 'Insufficient balance' };
        }

        // Get or create agent wallet
        const agentWallets = await tx
          .select()
          .from(wallets)
          .where(and(eq(wallets.ownerId, agentId), eq(wallets.ownerType, 'AGENT')))
          .limit(1);

        let agentWallet;
        if (agentWallets.length === 0) {
          const walletId = randomUUID();
          await tx.insert(wallets).values({
            id: walletId,
            ownerId: agentId,
            ownerType: 'AGENT',
            balance: '0.00',
            lifetimeEarned: '0.00',
            lifetimeSpent: '0.00',
            status: 'ACTIVE',
          });
          const newWallets = await tx.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
          agentWallet = newWallets[0];
        } else {
          agentWallet = agentWallets[0];
        }

        // Deduct from user
        await tx
          .update(wallets)
          .set({
            balance: sql`${wallets.balance} - ${amount}`,
            lifetimeSpent: sql`${wallets.lifetimeSpent} + ${amount}`,
            updatedAt: new Date(),
          })
          .where(eq(wallets.id, userWallet.id));

        // Add to agent
        await tx
          .update(wallets)
          .set({
            balance: sql`${wallets.balance} + ${amount}`,
            lifetimeEarned: sql`${wallets.lifetimeEarned} + ${amount}`,
            updatedAt: new Date(),
          })
          .where(eq(wallets.id, agentWallet.id));

        // Log transaction
        const transactionId = randomUUID();
        await tx.insert(transactions).values({
          id: transactionId,
          fromWalletId: userWallet.id,
          toWalletId: agentWallet.id,
          amount: amount.toFixed(2),
          transactionType: 'ALLOCATE',
          status: 'COMPLETED',
          reason: `Credit allocation to agent ${agentId}`,
          metadata: { userId, agentId },
        });

        return { success: true, transactionId };
      });
    } catch (error) {
      console.error('Error allocating credits:', error);
      return { success: false, error: 'Failed to allocate credits' };
    }
  }

  /**
   * Charge for a message (user pays agent owner)
   */
  async chargeForMessage(
    payerId: string,
    recipientId: string,
    amount: number,
    metadata: { messageId: string; agentId: string; tokenUsage: TokenUsage }
  ): Promise<{ success: boolean; error?: string; transactionId?: string }> {
    console.log('[credit-service] 💰 Starting chargeForMessage');
    console.log('[credit-service]    Payer:', payerId);
    console.log('[credit-service]    Recipient:', recipientId);
    console.log('[credit-service]    Amount:', amount);
    
    try {
      return await db.transaction(async (tx) => {
        // Get or create payer wallet
        const payerWallets = await tx
          .select()
          .from(wallets)
          .where(and(eq(wallets.ownerId, payerId), eq(wallets.ownerType, 'USER')))
          .limit(1);

        console.log('[credit-service] 👛 Payer wallets found:', payerWallets.length);
        
        let payerWallet;
        if (payerWallets.length === 0) {
          console.log('[credit-service] 🆕 Creating payer wallet with initial 10,000 credits');
          const walletId = randomUUID();
          await tx.insert(wallets).values({
            id: walletId,
            ownerId: payerId,
            ownerType: 'USER',
            balance: '10000.00',
            lifetimeEarned: '0.00',
            lifetimeSpent: '0.00',
            status: 'ACTIVE',
          });
          const newWallets = await tx.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
          payerWallet = newWallets[0];
        } else {
          payerWallet = payerWallets[0];
        }

        const currentBalance = parseFloat(payerWallet.balance);
        console.log('[credit-service] 💵 Payer balance:', currentBalance);

        if (currentBalance < amount) {
          console.log('[credit-service] ❌ Insufficient balance!');
          return { success: false, error: 'Insufficient balance' };
        }

        // Get or create recipient wallet
        const recipientWallets = await tx
          .select()
          .from(wallets)
          .where(and(eq(wallets.ownerId, recipientId), eq(wallets.ownerType, 'USER')))
          .limit(1);

        console.log('[credit-service] 👛 Recipient wallets found:', recipientWallets.length);

        let recipientWallet;
        if (recipientWallets.length === 0) {
          console.log('[credit-service] 🆕 Creating recipient wallet with initial 10,000 credits');
          const walletId = randomUUID();
          await tx.insert(wallets).values({
            id: walletId,
            ownerId: recipientId,
            ownerType: 'USER',
            balance: '10000.00',
            lifetimeEarned: '0.00',
            lifetimeSpent: '0.00',
            status: 'ACTIVE',
          });
          const newWallets = await tx.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
          recipientWallet = newWallets[0];
          console.log('[credit-service] ✅ Recipient wallet created:', walletId);
        } else {
          recipientWallet = recipientWallets[0];
          console.log('[credit-service] ✅ Using existing recipient wallet:', recipientWallet.id);
          console.log('[credit-service] 💵 Recipient balance before:', recipientWallet.balance);
        }

        // Deduct from payer
        console.log('[credit-service] 📉 Deducting from payer...');
        await tx
          .update(wallets)
          .set({
            balance: sql`${wallets.balance} - ${amount}`,
            lifetimeSpent: sql`${wallets.lifetimeSpent} + ${amount}`,
            updatedAt: new Date(),
          })
          .where(eq(wallets.id, payerWallet.id));

        // Add to recipient
        console.log('[credit-service] 📈 Adding to recipient...');
        await tx
          .update(wallets)
          .set({
            balance: sql`${wallets.balance} + ${amount}`,
            lifetimeEarned: sql`${wallets.lifetimeEarned} + ${amount}`,
            updatedAt: new Date(),
          })
          .where(eq(wallets.id, recipientWallet.id));

        // Log transaction
        const transactionId = randomUUID();
        console.log('[credit-service] 📝 Creating transaction record:', transactionId);
        await tx.insert(transactions).values({
          id: transactionId,
          fromWalletId: payerWallet.id,
          toWalletId: recipientWallet.id,
          amount: amount.toFixed(2),
          transactionType: 'EARN',
          status: 'COMPLETED',
          reason: `Payment for agent message`,
          metadata,
        });

        console.log('[credit-service] ✅ Transaction completed successfully!');
        return { success: true, transactionId };
      });
    } catch (error) {
      console.error('[credit-service] ❌ Error charging for message:', error);
      return { success: false, error: 'Failed to process payment' };
    }
  }

  /**
   * Request credits for an agent
   */
  async requestCredits(agentId: string, userId: string, amount: number, reason: string): Promise<{ success: boolean; requestId?: string; error?: string }> {
    try {
      const requestId = randomUUID();
      await db.insert(creditRequests).values({
        id: requestId,
        agentId,
        userId,
        amountRequested: amount.toFixed(2),
        status: 'PENDING',
        reason,
      });

      return { success: true, requestId };
    } catch (error) {
      console.error('Error creating credit request:', error);
      return { success: false, error: 'Failed to create credit request' };
    }
  }

  /**
   * Approve a credit request
   */
  async approveRequest(requestId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      return await db.transaction(async (tx) => {
        // Get the request
        const requests = await tx.select().from(creditRequests).where(eq(creditRequests.id, requestId)).limit(1);

        if (requests.length === 0) {
          return { success: false, error: 'Request not found' };
        }

        const request = requests[0];

        if (request.userId !== userId) {
          return { success: false, error: 'Unauthorized' };
        }

        if (request.status !== 'PENDING') {
          return { success: false, error: 'Request already processed' };
        }

        const amount = parseFloat(request.amountRequested);

        // Allocate credits
        const allocationResult = await this.allocateToAgent(userId, request.agentId, amount);

        if (!allocationResult.success) {
          return allocationResult;
        }

        // Mark request as approved
        await tx
          .update(creditRequests)
          .set({
            status: 'APPROVED',
            resolvedAt: new Date(),
          })
          .where(eq(creditRequests.id, requestId));

        return { success: true };
      });
    } catch (error) {
      console.error('Error approving credit request:', error);
      return { success: false, error: 'Failed to approve request' };
    }
  }

  /**
   * Reject a credit request
   */
  async rejectRequest(requestId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const requests = await db.select().from(creditRequests).where(eq(creditRequests.id, requestId)).limit(1);

      if (requests.length === 0) {
        return { success: false, error: 'Request not found' };
      }

      const request = requests[0];

      if (request.userId !== userId) {
        return { success: false, error: 'Unauthorized' };
      }

      if (request.status !== 'PENDING') {
        return { success: false, error: 'Request already processed' };
      }

      await db
        .update(creditRequests)
        .set({
          status: 'REJECTED',
          resolvedAt: new Date(),
        })
        .where(eq(creditRequests.id, requestId));

      return { success: true };
    } catch (error) {
      console.error('Error rejecting credit request:', error);
      return { success: false, error: 'Failed to reject request' };
    }
  }

  /**
   * Get transaction history
   */
  async getTransactions(ownerId: string, ownerType: OwnerType, limit: number = 50) {
    const wallet = await this.getOrCreateWallet(ownerId, ownerType);

    const txs = await db
      .select()
      .from(transactions)
      .where(
        sql`${transactions.fromWalletId} = ${wallet.id} OR ${transactions.toWalletId} = ${wallet.id}`
      )
      .orderBy(sql`${transactions.createdAt} DESC`)
      .limit(limit);

    return txs;
  }

  /**
   * Get pending credit requests for a user
   */
  async getPendingRequests(userId: string) {
    return await db
      .select()
      .from(creditRequests)
      .where(and(eq(creditRequests.userId, userId), eq(creditRequests.status, 'PENDING')))
      .orderBy(sql`${creditRequests.createdAt} DESC`);
  }
}

export const creditService = new CreditService();

