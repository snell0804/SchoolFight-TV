"""Playwright E2E test suite for SchoolFight-TV (game + Gear Studio + asset editor + cloud loader)."""
import functools
import http.server
import io
import json
import pathlib
import re
import tempfile
import threading
import unittest

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

REPO = pathlib.Path(__file__).resolve().parent.parent


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def make_sprite_sheet_png(path: pathlib.Path, cols: int, rows: int, cell_w: int = 100, cell_h: int = 85):
    """Generate a synthetic white-background cols×rows sprite sheet PNG for upload tests."""
    img = Image.new("RGBA", (cols * cell_w, rows * cell_h), (254, 254, 254, 255))
    draw = ImageDraw.Draw(img)
    for r in range(rows):
        for c in range(cols):
            x0, y0 = c * cell_w + 18, r * cell_h + 12
            draw.ellipse((x0, y0, x0 + cell_w - 36, y0 + cell_h - 20), fill=(60, 120, 230, 255))
    img.save(path)


class LargeBacklogHTTPServer(http.server.ThreadingHTTPServer):
    request_queue_size = 128


class SchoolFightE2ETest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(QuietHandler, directory=str(REPO))
        cls.srv = LargeBacklogHTTPServer(("127.0.0.1", 0), handler)
        cls.port = cls.srv.server_address[1]
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.pw = sync_playwright().start()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.sheet_10x4 = pathlib.Path(cls.tmp.name) / "test_10x4.png"
        make_sprite_sheet_png(cls.sheet_10x4, cols=10, rows=4)

    @classmethod
    def tearDownClass(cls):
        cls.pw.stop()
        cls.srv.shutdown()
        cls.srv.server_close()
        cls.tmp.cleanup()

    def new_page(self, keep_assets=()):
        browser = self.pw.chromium.launch(args=["--disable-dev-shm-usage", "--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        tiny_buf = io.BytesIO()
        Image.new("RGBA", (10, 4), (0, 0, 0, 0)).save(tiny_buf, format="PNG")
        tiny_png = tiny_buf.getvalue()

        def handle_asset(route):
            if any(k in route.request.url for k in keep_assets):
                route.continue_()
            else:
                route.fulfill(status=200, content_type="image/png", body=tiny_png)

        page.route(re.compile(r"/assets/.*\.(webp|png)(\?.*)?$"), handle_asset)
        return browser, page, errors

    def test_01_game_boot_and_editor_navigation(self):
        ctx, page, errors = self.new_page()
        try:
            page.route("https://api.github.com/**", lambda route: route.fulfill(status=404, body="{}"))
            page.goto(f"{self.base_url}/index.html", wait_until="domcontentloaded")
            page.wait_for_selector("#btnAssetEditor")
            page.wait_for_selector("#gameCanvas")
            with page.expect_navigation(url="**/editor.html"):
                page.click("#btnAssetEditor")
            page.wait_for_selector("text=SchoolFight-TV 素材編輯器")
            self.assertIn("editor.html", page.url)
            with page.expect_navigation(url="**/index.html"):
                page.click("text=返回大亂鬥")
            page.wait_for_selector("#gameCanvas")
            self.assertEqual(errors, [])
        finally:
            ctx.close()

    def test_02_gear_studio_manual_10x4_upload_and_reslice(self):
        ctx, page, errors = self.new_page()
        try:
            page.goto(f"{self.base_url}/index.html", wait_until="networkidle")
            page.click("#btnGear")
            page.wait_for_selector(".slot-card")
            row = page.locator(".slot-card").first
            in_cols = row.locator('input[title="欄數 (Cols)"]')
            in_rows = row.locator('input[title="列數 (Rows)"]')

            # Set 10x4 BEFORE upload -> must honor manual 10x4
            in_cols.fill("10")
            in_cols.dispatch_event("change")
            in_rows.fill("4")
            in_rows.dispatch_event("change")
            row.locator("input[type=file]").set_input_files(str(self.sheet_10x4))
            page.wait_for_timeout(900)

            self.assertEqual(in_cols.input_value(), "10")
            self.assertEqual(in_rows.input_value(), "4")
            self.assertIn("10×4 (40幀)", row.locator(".slot-status").inner_text())

            # Edit AFTER upload (5x2 -> back to 10x4) -> must re-slice cleanly from _rawImg
            in_cols.fill("5")
            in_cols.dispatch_event("change")
            in_rows.fill("2")
            in_rows.dispatch_event("change")
            page.wait_for_timeout(300)
            in_cols.fill("10")
            in_cols.dispatch_event("change")
            in_rows.fill("4")
            in_rows.dispatch_event("change")
            page.wait_for_timeout(400)

            db_info = page.evaluate("""async () => {
                const db = await new Promise((r, j) => {
                    const q = indexedDB.open('SchoolFightCustomSpritesDB_v1');
                    q.onsuccess = () => r(q.result); q.onerror = j;
                });
                const rec = await new Promise((r, j) => {
                    const q = db.transaction('sheets').objectStore('sheets').get('idle');
                    q.onsuccess = () => r(q.result); q.onerror = j;
                });
                const img = new Image();
                await new Promise(r => { img.onload = r; img.src = rec.dataUrl; });
                return { cols: rec.cols, rows: rec.rows, fc: rec.frameCount, w: img.width, h: img.height };
            }""")
            self.assertEqual(db_info, {"cols": 10, "rows": 4, "fc": 40, "w": 3000, "h": 1056})
            self.assertEqual(errors, [])
        finally:
            ctx.close()

    def test_03_editor_ui_validation_preview_and_tabs(self):
        ctx, page, errors = self.new_page()
        try:
            # Intercept GitHub API calls so the test stays 100% offline & deterministic
            page.route("https://api.github.com/**", lambda route: route.fulfill(status=404, body="{}"))
            page.goto(f"{self.base_url}/editor.html")
            page.wait_for_selector("text=SchoolFight-TV 素材編輯器")
            # Built-in game characters should be listed immediately (23 characters)
            page.wait_for_selector("text=呆呆伶")
            self.assertGreaterEqual(page.locator("aside ul li").count(), 23)

            # Open AI Modify Modal for the selected action, upload turnaround & action ref images
            page.click("#btnOpenAiModify")
            page.wait_for_selector("text=AI 招式動畫修改工作台")
            modal = page.locator("div.fixed.inset-0")
            modal.locator('input[type="file"]').nth(0).set_input_files(str(self.sheet_10x4))
            modal.locator('input[type="file"]').nth(1).set_input_files(str(self.sheet_10x4))
            modal.locator('button:has-text("關閉")').click()
            page.wait_for_selector("text=AI 招式動畫修改工作台", state="hidden")

            page.click('aside button[title="新增自訂角色"]')

            page.locator('input[placeholder="red_panda"]').fill("my_panda")
            page.locator('input[placeholder="uppercut"]').fill("shoryuken")
            cond = page.locator('input[placeholder^="例如：hp"]')
            cond.fill("alert(1)")
            page.wait_for_selector("text=Unsupported identifier")
            self.assertTrue(page.locator('button:has-text("儲存並建立 PR")').is_disabled())

            cond.fill("hp < 30 && state === 'hurt'")
            page.wait_for_selector("text=TRUE 觸發")
            page.set_input_files('input[type="file"][accept="image/png"]', str(self.sheet_10x4))
            page.wait_for_selector("text=1000×340px")
            self.assertFalse(page.locator('button:has-text("儲存並建立 PR")').is_disabled())

            for tab_name in ["背景", "道具", "AI 生成", "PR 紀錄"]:
                page.click(f'nav button:has-text("{tab_name}")')
            self.assertEqual(errors, [])
        finally:
            ctx.close()

    def test_04_cloud_manifest_loader_cache_and_condition_triggers(self):
        ctx, page, errors = self.new_page(keep_assets=("enemy_slime_angry_sheet.webp",))
        try:
            manifest = {
                "version": 1,
                "characters": [{
                    "id": "slime",
                    "name": "測試史萊姆",
                    "actions": [{
                        "id": "rage_hurt",
                        "label": "低血量暴怒",
                        "sheetKey": "custom_slime_rage_hurt",
                        "png": "assets/enemy_slime_angry_sheet.webp",
                        "webp": "assets/enemy_slime_angry_sheet.webp",
                        "cols": 5, "rows": 2, "frames": 10, "fps": 14, "loop": False,
                        "trigger": "on_hurt",
                        "condition": "hp < 30 && state === 'hurt'",
                        "priority": 10,
                        "updatedAt": "2026-11-25T19:00:00Z",
                    }],
                }],
                "backgrounds": [],
                "items": [],
            }
            page.route(
                re.compile(r"cloud_manifest\.json"),
                lambda route: route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(manifest),
                ),
            )
            page.goto(f"{self.base_url}/index.html", wait_until="networkidle")
            res = page.evaluate("""async () => {
                let cached = false;
                for (let i = 0; i < 40 && !cached; i++) {
                    try {
                        const db = await new Promise((r, j) => {
                            const q = indexedDB.open('SchoolFightCloudCacheDB_v1', 1);
                            q.onupgradeneeded = () => {
                                if (!q.result.objectStoreNames.contains('blobs')) q.result.createObjectStore('blobs', { keyPath: 'key' });
                            };
                            q.onsuccess = () => r(q.result); q.onerror = j;
                        });
                        cached = await new Promise((r) => {
                            const q = db.transaction('blobs').objectStore('blobs').get('sheet:custom_slime_rage_hurt');
                            q.onsuccess = () => r(!!q.result); q.onerror = () => r(false);
                        });
                        db.close();
                    } catch {}
                    if (!cached) await new Promise((r) => setTimeout(r, 150));
                }
                const bank = {
                    sheets: { custom_slime_rage_hurt: { frameCount: 10 } },
                    customActionsByChar: {
                        slime: [{ sheetKey: 'custom_slime_rage_hurt', trigger: 'on_hurt', condition: "hp < 30 && state === 'hurt'" }],
                    },
                };
                return {
                    cached,
                    highHp: !!window.CloudManifestLoader.pickCustomAction({ type: 'slime', hp: 80, maxHp: 100, state: 'hurt' }, bank),
                    lowHp: window.CloudManifestLoader.pickCustomAction({ type: 'slime', hp: 20, maxHp: 100, state: 'hurt' }, bank)?.sheetKey || null,
                    wrongState: !!window.CloudManifestLoader.pickCustomAction({ type: 'slime', hp: 20, maxHp: 100, state: 'approach' }, bank),
                };
            }""")
            self.assertTrue(res["cached"])
            self.assertFalse(res["highHp"])
            self.assertEqual(res["lowHp"], "custom_slime_rage_hurt")
            self.assertFalse(res["wrongState"])
            self.assertEqual(errors, [])
        finally:
            ctx.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
