import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // UISceneStoryboardFile loads Main.storyboard and installs this window
        // before willConnectTo. Its root is CAPBridgeViewController. Keep it.
        if window == nil {
            window = windowScene.windows.first { $0.rootViewController is CAPBridgeViewController }
                ?? windowScene.windows.first
        }
        if window == nil {
            let storyboardWindow = UIWindow(windowScene: windowScene)
            storyboardWindow.rootViewController = UIStoryboard(name: "Main", bundle: nil).instantiateInitialViewController()
            window = storyboardWindow
        }
        window?.makeKeyAndVisible()

        // SceneDelegateProxy (Capacitor 8.5+) is not in the linked 8.3.0 package.
        // Cold-start URLs are delivered after the bridge appears, same as that proxy.
        CapacitorSceneEvents.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        CapacitorSceneEvents.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        CapacitorSceneEvents.shared.scene(scene, continue: userActivity)
    }
}

/// Forwards scene URL opens and universal links through ApplicationDelegateProxy.
///
/// Capacitor 8.5.0 added SceneDelegateProxy, which also posts scene-scoped
/// notifications that do not exist in 8.3.0. ApplicationDelegateProxy is the
/// 8.3 path: it sets lastURL and posts .capacitorOpenURL, CDVPluginHandleOpenURL,
/// and .capacitorOpenUniversalLink, which is what the installed plugins observe.
private final class CapacitorSceneEvents: NSObject {
    static let shared = CapacitorSceneEvents()

    func scene(_ scene: UIScene, willConnectTo _: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        let urlContexts = connectionOptions.urlContexts
        let userActivities = connectionOptions.userActivities
        guard !urlContexts.isEmpty || !userActivities.isEmpty else { return }

        // Plugins are not registered yet on a cold start. Deliver on the first
        // bridge appearance, matching SceneDelegateProxy.
        var token: NSObjectProtocol?
        token = NotificationCenter.default.addObserver(forName: .capacitorViewDidAppear, object: nil, queue: .main) { [weak self] _ in
            if let token {
                NotificationCenter.default.removeObserver(token)
            }
            guard let self else { return }
            if !urlContexts.isEmpty {
                self.scene(scene, openURLContexts: urlContexts)
            }
            for activity in userActivities {
                self.scene(scene, continue: activity)
            }
        }
    }

    func scene(_: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared,
                open: context.url,
                options: Self.openURLOptions(from: context.options)
            )
        }
    }

    func scene(_: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            continue: userActivity,
            restorationHandler: { _ in }
        )
    }

    private static func openURLOptions(from sceneOptions: UIScene.OpenURLOptions) -> [UIApplication.OpenURLOptionsKey: Any] {
        var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
        if let sourceApplication = sceneOptions.sourceApplication {
            options[.sourceApplication] = sourceApplication
        }
        if let annotation = sceneOptions.annotation {
            options[.annotation] = annotation
        }
        options[.openInPlace] = sceneOptions.openInPlace
        return options
    }
}
