import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const guardedRoutes = new Map([
  ["payment-routes.js", new Set(["/api/payments/:ref", "/api/public/payments/:ref"])],
  ["settings-routes.js", new Set(["/api/owner-settings"])],
]);

const forbiddenCalls = new Set([
  "updateDb",
  "writeDb",
  "saveDb",
  "expirePendingOrders",
  "reconcilePakasirPaymentInDb",
  "fulfillPaidOrderAndNotify",
  "sendWhatsAppMessage",
  "validateGmailConnectionForStatus",
  "syncGoogleSheetsStock",
  "pushFulfilledOrderToGoogleSheets",
]);

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return "";
}

function findForbiddenCalls(node, results = []) {
  if (ts.isCallExpression(node)) {
    const name = callName(node.expression);
    if (forbiddenCalls.has(name)) results.push(name);
  }
  ts.forEachChild(node, (child) => findForbiddenCalls(child, results));
  return results;
}

test("critical GET handlers contain no database, provider, fulfillment, notification, or migration mutators", () => {
  const violations = [];
  for (const [fileName, routePaths] of guardedRoutes) {
    const filePath = path.resolve("server/routes", fileName);
    const source = fs.readFileSync(filePath, "utf8");
    const ast = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function visit(node) {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "get"
        && node.arguments.length >= 2
        && ts.isStringLiteral(node.arguments[0])
        && routePaths.has(node.arguments[0].text)
      ) {
        const handler = node.arguments[node.arguments.length - 1];
        const calls = findForbiddenCalls(handler);
        for (const call of calls) violations.push(`${fileName} ${node.arguments[0].text}: ${call}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  assert.deepEqual(violations, []);
});
