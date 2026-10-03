import UIKit
import UserNotifications

/// APNs（プッシュ通知。#475）の許可取得・デバイストークン・通知を押したときの遷移先を受け持つ。
/// **通知の中身・送るタイミングはサーバーが決める**。ここは「許可を取る・トークンを渡す・開く」だけ
final class PushRegistration: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushRegistration()

    /// サーバー（`src/lib/push/apns-core.ts` の `ApnsEnvironment`）へ渡す環境。Xcodeから入れるDebugビルドは
    /// sandbox、TestFlight・App Storeに載るReleaseは production のトークンになる
    static var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    /// 取れたデバイストークン（16進）。まだ取れていなければnil
    private(set) var token: String?
    /// トークンが取れた・変わったときに呼ぶ（WebViewModelがサーバーへ送る）
    var tokenHandler: (() -> Void)?
    /// 通知を押したときに開く先。WebViewModelが用意する前に押された分は `pendingTarget` に取っておく
    var openHandler: ((String) -> Void)? {
        didSet {
            if let pending = pendingTarget, let openHandler {
                pendingTarget = nil
                openHandler(pending)
            }
        }
    }

    private var pendingTarget: String?
    private var started = false

    /// 起動後に1回だけ許可を確認する。許可済みなら登録だけ行う（トークンは変わることがあるので毎回取り直す）
    func startIfNeeded() {
        guard !started else { return }
        started = true

        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    func didRegister(deviceToken: Data) {
        token = deviceToken.map { String(format: "%02x", $0) }.joined()
        tokenHandler?()
    }

    // MARK: UNUserNotificationCenterDelegate

    /// アプリを開いているあいだも、バナーと音で知らせる
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    /// 通知を押した。`url` はサーバーが載せた遷移先（アプリ内のパスか、外部のURL）
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let target = response.notification.request.content.userInfo["url"] as? String else { return }
        await MainActor.run {
            if let openHandler {
                openHandler(target)
            } else {
                pendingTarget = target
            }
        }
    }
}

/// `UIApplicationDelegate` はデバイストークンの受け取りにだけ使う
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        PushRegistration.shared.didRegister(deviceToken: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // シミュレータ・Push未対応のビルドでは失敗する。通知が来ないだけでアプリは使えるので何もしない
    }
}
