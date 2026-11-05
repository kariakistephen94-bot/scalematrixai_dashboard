import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveMessage } from '../lib/messaging.js';
test('Nigeria greetings update for morning, afternoon and evening', () => {
 const result={message_body:'We help Solar One qualify buyers.',recipient_timezone:'Africa/Lagos'};
 assert.match(liveMessage(result,new Date('2026-10-28T08:00:00Z')),/good morning/);
 assert.match(liveMessage(result,new Date('2026-10-28T13:00:00Z')),/good afternoon/);
 assert.match(liveMessage(result,new Date('2026-10-28T18:00:00Z')),/good evening/);
});
test('China and US greetings use recipient time instead of the browser timezone', () => {
 const result={message_body:'Message',recipient_timezone:'Asia/Shanghai'};
 assert.match(liveMessage(result,new Date('2026-10-28T10:00:00Z')),/good evening/);
 result.recipient_timezone='America/Los_Angeles';
 assert.match(liveMessage(result,new Date('2026-10-28T10:00:00Z')),/good morning/);
});
