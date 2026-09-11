import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { type Transaction, schema, withTenant } from '@nexmarket/db';
import { getRequestContext } from '../../common/request-context.js';
import type { AskInput, AnswerInput, ModerateReviewInput } from './dto.js';

export type AnswerView = {
  id: string;
  body: string;
  authorName: string;
  /** The organisation the answerer was acting for, or null for a shopper. */
  sellerName: string | null;
  status: 'PUBLISHED' | 'FLAGGED' | 'REMOVED';
  createdAt: Date;
};

export type QuestionView = {
  id: string;
  productId: string;
  body: string;
  authorName: string;
  status: 'PUBLISHED' | 'FLAGGED' | 'REMOVED';
  createdAt: Date;
  answers: AnswerView[];
};

/**
 * Product Q&A. PRD 9.5's "Q&A section"; PRD 9.2's seller staff who "answer
 * product questions".
 *
 * ASKING NEEDS NO PURCHASE, and that single difference is why this is a
 * separate service rather than another method on `ReviewsService`. A review is
 * a verdict on something you received, so it hangs off an order line and cannot
 * exist without one. A question is what you ask BEFORE buying - "does it come
 * with the charger?" - and requiring a purchase would leave it askable only by
 * the people who no longer need to ask.
 *
 * The consequence is that Q&A has no verification to lean on, so it leans on
 * moderation instead: the same `review_status`, the same queue, the same rule
 * that a report flags rather than hides.
 */
@Injectable()
export class QuestionsService {
  // ---- public reads ---------------------------------------------------------

  /**
   * A product's questions with their answers, oldest question first.
   *
   * OLDEST FIRST, unlike reviews. A Q&A section is a growing FAQ rather than a
   * feed: the question everyone asks is usually the first one anybody asked,
   * and burying it under today's makes a reader scroll to find what the person
   * before them already had answered.
   *
   * Two queries, never one per question - the N+1 this codebase keeps finding,
   * and it would land on the product page.
   */
  async forProduct(productId: string, limit = 20): Promise<QuestionView[]> {
    return this.public((tx) => this.read(tx, productId, limit));
  }

  /**
   * The same read, against a CALLER'S transaction.
   *
   * Split out because `ask` and `answer` return the question they just wrote,
   * and a read on a fresh connection cannot see a row the request transaction
   * has not committed - it answered "No such question" about the question it
   * had just inserted. Uncommitted writes are visible only inside the
   * transaction that made them, and opening a second one is how you forget
   * that.
   */
  private async read(
    tx: Transaction,
    productId: string,
    limit: number,
  ): Promise<QuestionView[]> {
    {
      const rows = await tx
        .select({ question: schema.questions, authorName: schema.users.displayName })
        .from(schema.questions)
        .innerJoin(schema.users, eq(schema.users.id, schema.questions.authorUserId))
        .where(
          and(
            eq(schema.questions.productId, productId),
            sql`${schema.questions.status} <> 'REMOVED'`,
          ),
        )
        .orderBy(asc(schema.questions.createdAt))
        .limit(limit);

      if (rows.length === 0) return [];

      const answers = await tx
        .select({
          answer: schema.answers,
          authorName: schema.users.displayName,
          sellerName: schema.organisations.displayName,
        })
        .from(schema.answers)
        .innerJoin(schema.users, eq(schema.users.id, schema.answers.authorUserId))
        // LEFT, because most answers come from other shoppers and those are not
        // a lesser kind of answer.
        .leftJoin(
          schema.organisations,
          eq(schema.organisations.id, schema.answers.sellerOrgId),
        )
        .where(
          and(
            inArray(
              schema.answers.questionId,
              rows.map((row) => row.question.id),
            ),
            sql`${schema.answers.status} <> 'REMOVED'`,
          ),
        )
        .orderBy(asc(schema.answers.createdAt));

      const byQuestion = new Map<string, AnswerView[]>();
      for (const row of answers) {
        const list = byQuestion.get(row.answer.questionId) ?? [];
        list.push({
          id: row.answer.id,
          body: row.answer.body,
          authorName: row.authorName,
          sellerName: row.sellerName,
          status: row.answer.status,
          createdAt: row.answer.createdAt,
        });
        byQuestion.set(row.answer.questionId, list);
      }

      return rows.map((row) => ({
        id: row.question.id,
        productId: row.question.productId,
        body: row.question.body,
        authorName: row.authorName,
        status: row.question.status,
        createdAt: row.question.createdAt,
        answers: byQuestion.get(row.question.id) ?? [],
      }));
    }
  }

  // ---- writes ---------------------------------------------------------------

  /** Ask. Any signed-in person, about any product that exists. */
  async ask(input: AskInput): Promise<QuestionView> {
    const ctx = this.user();

    const [product] = await ctx.tx
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.id, input.productId))
      .limit(1);
    if (product === undefined) throw new NotFoundException('No such product');

    const [row] = await ctx.tx
      .insert(schema.questions)
      .values({ productId: input.productId, authorUserId: ctx.userId, body: input.body })
      .returning({ id: schema.questions.id });
    if (row === undefined) throw new NotFoundException('No such product');

    return this.one(ctx.tx, input.productId, row.id);
  }

  /**
   * Answer, and be recorded as the seller if you were acting as one.
   *
   * The org is taken from the REQUEST CONTEXT - the `x-tenant-id` the console
   * sends - and then verified against `org_members`, never trusted. A header
   * that promoted an answer to "the seller says" without a membership check
   * would make the badge worth exactly nothing.
   *
   * Stored rather than inferred at read time, because memberships change and an
   * answer must keep saying who gave it.
   */
  async answer(questionId: string, input: AnswerInput): Promise<QuestionView> {
    const ctx = this.user();
    const { tenantId } = getRequestContext();

    const [question] = await ctx.tx
      .select({ id: schema.questions.id, productId: schema.questions.productId })
      .from(schema.questions)
      .where(eq(schema.questions.id, questionId))
      .limit(1);
    if (question === undefined) throw new NotFoundException('No such question');

    let sellerOrgId: string | null = null;
    if (tenantId !== null) {
      const [membership] = await ctx.tx
        .select({ tenantId: schema.orgMembers.tenantId })
        .from(schema.orgMembers)
        .where(
          and(
            eq(schema.orgMembers.tenantId, tenantId),
            eq(schema.orgMembers.userId, ctx.userId),
          ),
        )
        .limit(1);
      if (membership === undefined) {
        throw new ForbiddenException('You do not belong to that organisation');
      }
      sellerOrgId = tenantId;
    }

    await ctx.tx
      .insert(schema.answers)
      .values({ questionId, authorUserId: ctx.userId, sellerOrgId, body: input.body });

    return this.one(ctx.tx, question.productId, questionId);
  }

  /** Withdraw your own question. Answers go with it, by cascade. */
  async removeQuestion(id: string): Promise<void> {
    const ctx = this.user();
    const result = await ctx.tx
      .delete(schema.questions)
      // Both predicates, always. `eq(id)` alone deletes somebody else's.
      .where(and(eq(schema.questions.id, id), eq(schema.questions.authorUserId, ctx.userId)))
      .returning({ id: schema.questions.id });
    if (result.length === 0) throw new NotFoundException('No such question');
  }

  // ---- moderation -----------------------------------------------------------

  /**
   * The same three verbs reviews get, on a question.
   *
   * Returns the STATUS, not the question. Reading the row back would mean
   * reading through `read`, which filters REMOVED - so removing a question
   * threw a 404 on the way out and Nest rolled the update back with it. The
   * question was still on the page and the moderator had been told it did not
   * exist. An admin taking something down does not need the thing back.
   */
  async moderateQuestion(
    id: string,
    input: ModerateReviewInput,
  ): Promise<{ id: string; status: 'PUBLISHED' | 'FLAGGED' | 'REMOVED' }> {
    const { tx } = getRequestContext();
    const status = statusFor(input.action);

    const [result] = await tx
      .update(schema.questions)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.questions.id, id))
      .returning({ id: schema.questions.id });
    if (result === undefined) throw new NotFoundException('No such question');

    return { id: result.id, status };
  }

  async moderateAnswer(id: string, input: ModerateReviewInput): Promise<void> {
    const { tx } = getRequestContext();
    const result = await tx
      .update(schema.answers)
      .set({ status: statusFor(input.action), updatedAt: new Date() })
      .where(eq(schema.answers.id, id))
      .returning({ id: schema.answers.id });
    if (result.length === 0) throw new NotFoundException('No such answer');
  }

  /** Everything a human still has to look at, across questions and answers. */
  async flagged(limit = 50): Promise<QuestionView[]> {
    const { tx } = getRequestContext();
    const rows = await tx
      .select({ productId: schema.questions.productId })
      .from(schema.questions)
      .where(eq(schema.questions.status, 'FLAGGED'))
      .orderBy(desc(schema.questions.updatedAt))
      .limit(limit);

    const seen = new Set<string>();
    const out: QuestionView[] = [];
    for (const row of rows) {
      if (seen.has(row.productId)) continue;
      seen.add(row.productId);
      out.push(...(await this.forProduct(row.productId)));
    }
    return out;
  }

  // ---- internals ------------------------------------------------------------

  /** One question with its answers, read through the CALLER's transaction so a
   *  write it has not committed is still visible. */
  private async one(tx: Transaction, productId: string, id: string): Promise<QuestionView> {
    const all = await this.read(tx, productId, 200);
    const found = all.find((row) => row.id === id);
    if (found === undefined) throw new NotFoundException('No such question');
    return found;
  }

  /** @Public() routes skip the interceptor, so they open their own. Same
   *  reasoning as `ReviewsService.public` and `CatalogueService`. */
  private async public<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant({ tenantId: null, userId: null, isAdmin: false }, fn);
  }

  private user(): { tx: Transaction; userId: string } {
    const ctx = getRequestContext();
    if (ctx.userId === null) throw new NotFoundException('No such question');
    return { tx: ctx.tx, userId: ctx.userId };
  }
}

function statusFor(action: ModerateReviewInput['action']): 'PUBLISHED' | 'FLAGGED' | 'REMOVED' {
  if (action === 'REMOVE') return 'REMOVED';
  return action === 'FLAG' ? 'FLAGGED' : 'PUBLISHED';
}
