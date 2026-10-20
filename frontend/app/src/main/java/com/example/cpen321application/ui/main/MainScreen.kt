package com.example.cpen321application.ui.main

import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.example.cpen321application.ui.route.RouteScreen

/** The routes inside Main. */
object MainRoutes {
    const val MAP = "map"
    const val HISTORY = "history"
    const val PROFILE = "profile"
    const val EDIT_PROFILE = "profile/edit" // Edit vehicle or Edit transit, whichever Profile opened
}

/** One of the nav bar's tabs. */
enum class Tab(val route: String, val label: String, val icon: ImageVector) {
    MAP(MainRoutes.MAP, "Map", Icons.Filled.Place),
    HISTORY(MainRoutes.HISTORY, "History", Icons.Filled.DateRange),
    PROFILE(MainRoutes.PROFILE, "Profile", Icons.Filled.Person),
}

/**
 * The signed-in app: the Map, History, and Profile tabs with the nav bar below them.
 *
 * Map is the start, so Back there exits the app, and Back on another tab returns to
 * Map. Each tab keeps its place when the user switches away and back. The bar is
 * hidden on the edit screens.
 *
 * @param history The History tab, with the trip history and commute insights.
 * @param profile The Profile tab, called with a function that opens the edit screen.
 * @param editProfile The Edit vehicle or Edit transit screen, called with a function that returns to Profile.
 */
@Composable
fun MainScreen(
    history: @Composable () -> Unit,
    profile: @Composable (onEdit: () -> Unit) -> Unit,
    editProfile: @Composable (onDone: () -> Unit) -> Unit,
) {
    val navController = rememberNavController()
    val currentRoute = navController.currentBackStackEntryAsState().value?.destination?.route

    Scaffold(
        bottomBar = {
            val tab = Tab.entries.firstOrNull { it.route == currentRoute }
            if (tab != null) TabBar(tab) { navController.openTab(it) }
        },
    ) { padding ->
        NavHost(
            navController,
            startDestination = MainRoutes.MAP,
            modifier = Modifier.padding(padding).consumeWindowInsets(padding), // so screens don't pad the bars twice
        ) {
            composable(MainRoutes.MAP) { RouteScreen() }
            composable(MainRoutes.HISTORY) { history() }
            composable(MainRoutes.PROFILE) { profile { navController.navigate(MainRoutes.EDIT_PROFILE) } }
            composable(MainRoutes.EDIT_PROFILE) { editProfile { navController.popBackStack() } }
        }
    }
}

// the nav bar, with the selected tab highlighted; tapping the tab the user is on does nothing
@Composable
private fun TabBar(selected: Tab, onSelect: (Tab) -> Unit) {
    NavigationBar {
        Tab.entries.forEach { tab ->
            NavigationBarItem(
                selected = tab == selected,
                onClick = { if (tab != selected) onSelect(tab) },
                icon = { Icon(tab.icon, contentDescription = null) }, // the label below names it
                label = { Text(tab.label) },
            )
        }
    }
}

// keeps only Map below the new tab, so Back returns to Map, and saves and restores each tab's place
private fun NavHostController.openTab(tab: Tab) {
    navigate(tab.route) {
        popUpTo(MainRoutes.MAP) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
