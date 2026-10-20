# Requirements and Design


## 1. Change History


| **Change Date**   | **Modified Sections** | **Rationale** |
| ----------------- | --------------------- | ------------- |
| Oct 15, 2026 | 4.2 | Added the MongoDB `users` and `sessions` collections for Google sign-in (#9). |
| Oct 16, 2026 | 4.2 | Added the commute profile fields to `users` for the questionnaire (#10). |
| Oct 19, 2026 | 2, 3, 4 | Filled in the project description, requirements, and design for sign-in, the commute questionnaire, chained commute planning, and trip history, and added the `trips` collection (#20). |
| Oct 19, 2026 | 3.6 | Added rough screen mock-ups for sign-in, the main screen, trip history, profile, settings, and preferences. |


---


## 2. Project Description


Trailmix is an Android app for **chained commutes**: driving partway, then taking transit from a split point. Regular map apps plan one travel mode per trip, so they can't plan "drive to the station, then take the SkyTrain." Trailmix plans both legs together, personalizes trip costs to the user's car and transit fare (goal), and saves each trip to a history with time and cost insights (goal: saving planned trips).


---


## 3. Requirements Specification


### **3.1. List of Features**

1. **Authentication**: Sign in with Google and sign out.
2. **Commute Profile**: A first-time questionnaire about the user's car (make, model, fuel use) and transit fare type. It will be used to estimate trip costs (goal).
3. **Chained Commute Planning**: Pick a start, split point, and destination on a map, and get a drive leg plus a transit leg with their times. Trailmix will choose the split point automatically (goal).
4. **Trip History and Insights**: View past trips by date and cost, and see average time, average cost, and driving vs transit time. Planned trips will be saved here automatically (goal).


### **3.2. Use Case Diagram**




### **3.3. Actors Description**
1. **User**: A commuter using the app.
2. **Google Sign-In**: Authenticates the user.
3. **Google Routes API**: Provides driving and transit routes.


### **3.4. Use Case Description**
- Use cases for feature 1: **Authentication**
1. **Sign In with Google**: The user signs in, and an account is created on first sign-in.
2. **Sign Out**: Ends the session on this device.
- Use cases for feature 2: **Commute Profile**
3. **Complete Questionnaire**: The user saves their car and transit details.
- Use cases for feature 3: **Chained Commute Planning**
4. **Plan Chained Commute**: The user sets three points and sees the drive and transit legs.
5. **Reset Route**: Clears the points and route.
- Use cases for feature 4: **Trip History and Insights**
6. **View Trip History**: Lists trips, filtered by date range and sorted by date or cost.
7. **View Commute Insights**: Shows the stats for a chosen period.


### **3.5. Formal Use Case Specifications (5 Most Major Use Cases)**
<a name="uc1"></a>


#### Use Case 1: Sign In with Google


**Description**: The user signs in to Trailmix.


**Primary actor(s)**: User, Google Sign-In
  
**Main success scenario**:
1. The user taps "Sign in with Google" and picks an account.
2. The backend verifies the Google token and creates a session.
3. The app shows the questionnaire (if the profile isn't finished) or the main screen.


**Failure scenario(s)**:
- 1a. The user closes the account picker.
   - 1a1. The app stays on the sign-in screen.


- 2a. The token is invalid or the network fails.
   - 2a1. The app shows a sign-in error.


<a name="uc2"></a>


#### Use Case 2: Complete Questionnaire


**Description**: The user saves their driving and transit details.


**Primary actor(s)**: User
  
**Main success scenario**:
1. The user enters their car details (if they drive) and transit fare type.
2. The user taps "Submit".
3. The backend validates and saves the answers. The app shows the main screen.


**Failure scenario(s)**:
- 2a. An answer is missing or invalid.
   - 2a1. The app marks the field and doesn't submit.


- 3a. The save fails.
   - 3a1. The app shows an error and keeps the answers.


<a name="uc3"></a>


#### Use Case 3: Plan Chained Commute


**Description**: The user plans a drive-then-transit trip.


**Primary actor(s)**: User, Google Routes API
  
**Main success scenario**:
1. The user taps the start, split point, and destination on the map.
2. The backend gets the drive and transit legs from the Routes API.
3. The app draws both legs and shows each leg's time and the total.
4. The trip is saved to the user's history (goal).


**Failure scenario(s)**:
- 2a. There is no route for a leg.
   - 2a1. The app shows "No route found."


- 2b. The request fails or times out.
   - 2b1. The app shows an error with Retry.


<a name="uc4"></a>


#### Use Case 4: View Trip History


**Description**: The user browses past trips.


**Primary actor(s)**: User
  
**Main success scenario**:
1. The user opens Trip history.
2. The app lists trips, newest first.
3. The user changes the date range or sort.


**Failure scenario(s)**:
- 2a. There are no trips.
   - 2a1. The app shows "No trips yet."


- 2b. Loading fails.
   - 2b1. The app shows an error with Retry.


<a name="uc5"></a>


#### Use Case 5: View Commute Insights


**Description**: The user sees a summary of their commuting.


**Primary actor(s)**: User
  
**Main success scenario**:
1. The user opens Commute insights and picks a period.
2. The app shows the trip count, average time, average cost, and a driving vs transit pie chart.


**Failure scenario(s)**:
- 2a. There are no trips in the period.
   - 2a1. The app shows a "No trips found" message.


- 2b. Loading fails.
   - 2b1. The app shows an error with Retry.


### **3.6. Screen Mock-ups**

These are rough hand-drawn sketches of the planned layout, and the details will change.

1. **Sign-in**: Shown when the app is first downloaded or the user is signed out, with Sign up, Log in, and an About button.
2. **Main screen**: A map with a search bar (details still to be decided) and a bottom bar for Map, Trip history, and Profile.

![Sketches of the sign-in screen and the main map screen](images/mockup-sign-in-and-main.png)

3. **Trip history**: A sort bar and a list of trips, each showing the route, total time, and wait time.
4. **Profile**: The user's name, email, and photo, buttons for Settings and Preferences, and a Commute insights section.
5. **Settings** and **Preferences**: Separate screens opened from Profile, not designed yet.

![Sketches of the trip history, profile, settings, and preferences screens](images/mockup-history-profile-settings.png)


### **3.7. Non-Functional Requirements**
<a name="nfr1"></a>


1. **Response Time**
   - **Description**: A chained route is returned within 3 seconds.
   - **Justification**: Users compare split points before leaving, so planning must feel quick.
<a name="nfr2"></a>
2. **Security**
   - **Description**: In production, all traffic uses HTTPS, and all user data requires a valid session.
   - **Justification**: Trips reveal where users live and work.


---


## 4. Designs Specification
### **4.1. Main Components**
1. **Auth**
   - **Purpose**: Google sign-in and sessions.
   - **Interfaces**:
       1. `POST /api/auth/google { idToken }` → `{ sessionToken, user }`
           - **Purpose**: Signs in and creates a session.
       2. `POST /api/auth/sign-out`
           - **Purpose**: Ends this device's session.
2. **Users**
   - **Purpose**: Account and commute profile.
   - **Interfaces**:
       1. `GET /api/users/me` → `{ user }`
           - **Purpose**: Gets the signed-in user.
       2. `PUT /api/users/me/profile { timezone, vehicle, transit }` → `{ user }`
           - **Purpose**: Saves the questionnaire answers.
       3. `GET /api/vehicles/makes`, `GET /api/vehicles/makes/:make/models`
           - **Purpose**: Gets the car options.
3. **Routes**
   - **Purpose**: Chained route planning.
   - **Interfaces**:
       1. `POST /api/routes/chained { start, split, destination }` → `{ legs, totalDurationSeconds }`
           - **Purpose**: Returns the drive and transit legs. Leg costs from the user's profile will be added (goal).
4. **Trips**
   - **Purpose**: Trip history.
   - **Interfaces**:
       1. `GET /api/users/me/trips` → `{ trips }`
           - **Purpose**: Gets the user's trips, newest first.
       2. An endpoint to save a planned trip (goal).
           - **Purpose**: Adds a planned trip to the user's history.




### **4.2. Databases**
1. **MongoDB (`mongo:7.0`)**
   - **Purpose**: Stores Trailmix's accounts, sign-in sessions, and trips. It runs as a container next to the backend on the VM and is reachable only over the private docker compose network. Its data lives in the `mongo-data` volume, so it survives restarts, rebuilds, and deploys.
   - **`users` collection**: one document per account, with `googleId` (Google's account ID), `email`, `name`, `photoUrl`, `profileComplete`, `timezone`, `vehicle`, `transit`, `createdAt`, and `updatedAt`.
       - A **unique index on `googleId`** identifies users by the Google ID, which never changes, rather than by email, which can. The index also makes the database refuse a second account for the same Google account, even when two first sign-ins arrive at once.
       - The email, name, and photo are refreshed from Google on every sign-in.
       - The commute questionnaire adds `timezone`, `vehicle` (`make`, `model`, `colour`, `litresPer100km`, or `null` if the user doesn't drive), and `transit` (`fareType`, `monthlyPassZones`, or `null` if the user doesn't take transit). They sit inside the user document because there's only one of each and they're always loaded with the user. Only the fare type is stored, not the price, since fares change every year. Submitting the questionnaire replaces all three and sets `profileComplete`.
       - The car makes and models the questionnaire offers come from `backend/src/data/vehicles.json`, a hand-picked list in the repo loaded once at startup, not from the database.
   - **`sessions` collection**: one document per signed-in device, with `tokenHash`, `userId`, and `createdAt`.
       - The app holds a random 256-bit token. Only its SHA-256 hash is stored (with a **unique index**), so a leaked database can't be used to sign in, and finding a session is one indexed lookup.
       - Sessions are kept separate from users so one user can be signed in on several devices, and signing out deletes only that device's session.
       - Sessions never expire on their own. A session ends when its device signs out, or when the account is deleted (`userId` is **indexed** so every session for the account can be removed at once). A session whose account no longer exists is rejected.
   - **`trips` collection**: one document per trip, with its origin, split point, destination, legs, total time and cost, and date. It is indexed on `userId` and `tripDate` for the history query. For now, trips come from a seed script, and saving planned trips is a goal.




### **4.3. External Modules**
1. **Google Sign-In**
- **Purpose**: Authenticates users.
2. **Google Routes API**
- **Purpose**: Computes the drive and transit legs.
3. **Google Maps SDK**
- **Purpose**: Displays the map and routes.




### **4.4. Frameworks and Libraries**
1. **Kotlin + Jetpack Compose**
   - **Purpose**: Android UI.
   - **Reason**: Course requirement.
2. **Node.js + TypeScript + Express**
   - **Purpose**: Backend server.
   - **Reason**: Course requirement. Types catch errors early.
3. **Mongoose**
   - **Purpose**: MongoDB access and validation.
   - **Reason**: Typed schemas and indexes.
4. **Docker + Caddy (GCP VM)**
   - **Purpose**: Deployment and HTTPS.
   - **Reason**: Caddy renews HTTPS certificates automatically.





### **4.5. Dependencies Diagram**


### **4.6. Use Case Sequence Diagram (5 Most Major Use Cases)**
1. [**[WRITE_NAME_HERE]**](#uc1)\
[SEQUENCE_DIAGRAM_HERE]
2. ...


### **4.7. Design of Non-Functional Requirements**
1. [**Response Time**](#nfr1)
   - **Implementation**: Both legs are requested in parallel, and each request times out after 10 s.
2. [**Security**](#nfr2)
   - **Implementation**: Caddy is the only public entry point and serves HTTPS. Session tokens are stored hashed, and every user-data endpoint checks the session.
