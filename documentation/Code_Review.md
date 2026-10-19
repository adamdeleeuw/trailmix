# Code Review

## 1. Change History

| **Change Date**   | **Modified Sections** | **Rationale** |
| ----------------- | --------------------- | ------------- |
| 2026-10-16        | 2.4 | Justified the "Promise returned in function argument" warnings on the Express routes (issue #10) |

---

## 2. Automated Code Review Results

### 2.1. Commit Hash Where Codacy Ran

`[Insert Commit SHA here]`

### 2.2. Unfixed Issues per Codacy Category

_(Placeholder for screenshots of Codacy's Category Breakdown table in Overview)_

### 2.3. Unfixed Issues per Codacy Code Pattern

_(Placeholder for screenshots of Codacy's Issues page)_

### 2.4. Justifications for Unfixed Issues

- **Code Pattern: Promise returned in function argument where a void return was expected** (`@typescript-eslint/no-misused-promises`)

  1. **Issue**

     - **Location in Git:** [`backend/src/routes/users.route.ts#L8`](../backend/src/routes/users.route.ts#L8)
     - **Justification:** `requireSession` and `saveProfile` are async route handlers. This rule warns because a plain callback that returns a promise can lose its error. Express 5 doesn't have that problem. Its router waits for the promise a handler returns and passes any rejection to `next()`, which sends it to our error handler (`backend/node_modules/router/lib/layer.js`, the `isPromise(ret)` check). Express 5's types also declare a handler's return type as `unknown`, not `void`, so with the real types the rule has nothing to report. Codacy flags it because it can't load the Express types. The mocked API tests prove errors are handled, since a failing database call returns a 500 instead of crashing.

  2. **Issue**

     - **Location in Git:** [`backend/src/routes/vehicles.route.ts#L7`](../backend/src/routes/vehicles.route.ts#L7)
     - **Justification:** Same as above, for the async `requireSession` in front of `getMakes`.

  3. **Issue**

     - **Location in Git:** [`backend/src/routes/vehicles.route.ts#L8`](../backend/src/routes/vehicles.route.ts#L8)
     - **Justification:** Same as above, for the async `requireSession` in front of `getModels`.

  The same warning on [`backend/src/routes/auth.route.ts`](../backend/src/routes/auth.route.ts) and [`backend/src/routes/users.route.ts#L7`](../backend/src/routes/users.route.ts#L7) was ignored for the same reason in issue #9. Wrapping every handler to silence the rule would add code that does nothing Express 5 doesn't already do.

---

## 3. Manual Code Review Results

### 3.1. Review You Performed

- **Peer group reviewed:** [WRITE_HERE]
- **Commit SHA reviewed:** `[Insert Commit SHA here]`
- **Date the artifacts were exchanged:** [WRITE_HERE]
- **Review report submitted:** [`<CP#>_<YourPeerGroupName>_Review.pdf`](#)

| **Section**          | **Item**                                                                                                                                             | **Score** |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Manual code review   | Code is maintainable (well-documented, uses self-explanatory variable names, does not have complicated and long methods, magic numbers, etc.), efficient, handles error cases well | x/10      |
| Manual test review   | Tests are complete (all APIs exposed to the front-end are tested, three main features are tested), errors and edge cases are thoroughly tested, correct assertions are used | x/10      |
| Manual test review   | Test code is maintainable and well-structured                                                                                                          | x/10      |
| Manual test review   | Test implementation matches the requirements and design                                                                                                | x/10      |
| Manual test review   | Non-functional requirements are tested well                                                                                                            | x/10      |
| Manual test review   | Tests achieve high coverage and cases of < 100% coverage are well-justified                                                                            | x/10      |
| Manual test review   | All back-end tests can be run automatically                                                                                                            | x/10      |
| Automated code review| Codacy runs with the required setup                                                                                                                    | x/10      |
| Automated code review| All remaining Codacy issues are well-justified                                                                                                          | x/10      |

**Major fault reported**

- **Description:** ...
- **Steps to reproduce:** ...
- **Screenshots:** _(Placeholder for screenshots of the reported fault)_
- **Severity:** ...

### 3.2. Review You Received

- **Reviewing group:** [WRITE_HERE]
- **Commit SHA that was reviewed:** `[Insert Commit SHA here]`
- **Review report received:** [`<CP#>_<YourGroupName>_Review.pdf`](#)

| **Section**          | **Item**                                                                                                                                             | **Score** |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Manual code review   | Code is maintainable, efficient, handles error cases well                                                                                               | x/10      |
| Manual test review   | Tests are complete, errors and edge cases are thoroughly tested, correct assertions are used                                                            | x/10      |
| Manual test review   | Test code is maintainable and well-structured                                                                                                          | x/10      |
| Manual test review   | Test implementation matches the requirements and design                                                                                                | x/10      |
| Manual test review   | Non-functional requirements are tested well                                                                                                            | x/10      |
| Manual test review   | Tests achieve high coverage and cases of < 100% coverage are well-justified                                                                            | x/10      |
| Manual test review   | All back-end tests can be run automatically                                                                                                            | x/10      |
| Automated code review| Codacy runs with the required setup                                                                                                                    | x/10      |
| Automated code review| All remaining Codacy issues are well-justified                                                                                                          | x/10      |

**Major fault reported against your project**

- **Description:** ...
- **Severity:** ...

### 3.3. Actions Taken in Response to the Review

| **Finding** | **Action Taken** | **Commit / Location in Git** |
| ----------- | ---------------- | ---------------------------- |
| ...         | ...              | [`src/...`](#)               |
| ...         | ...              | ...                          |

- **Findings not acted on.** For each finding you decided not to address, give the reason:
  1. **Finding:** ...
     - **Justification:** ...
