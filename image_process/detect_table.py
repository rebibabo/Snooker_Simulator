"""
检测斯诺克球桌绿色和棕色边界.
"""
import cv2
import numpy as np


HSV_LOWER   = np.array([35, 80, 80])
HSV_UPPER   = np.array([85, 255, 255])
OPEN_KSIZE  = 7
CLOSE_KSIZE = 21
SHELL_WIDTH = 9


def detect_snooker_table(img_bgr, debug=False):
    # 1) HSV 过滤亮绿色桌面
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, HSV_LOWER, HSV_UPPER)

    # 2) 形态学: 开运算去小噪点, 闭运算填球孔
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (OPEN_KSIZE, OPEN_KSIZE)))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (CLOSE_KSIZE, CLOSE_KSIZE)))

    # 3) 最大连通域
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n <= 1:
        return (None, {}) if debug else None
    idx = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    table_mask = np.uint8(labels == idx) * 255

    # 4) 轮廓 + 凸包外壳过滤 (去手伸入的凹陷)
    contours, _ = cv2.findContours(table_mask, cv2.RETR_EXTERNAL,
                                    cv2.CHAIN_APPROX_NONE)
    if not contours:
        return (None, {}) if debug else None
    cnt = max(contours, key=cv2.contourArea).reshape(-1, 2)
    hull = cv2.convexHull(cnt).reshape(-1, 2)

    h, w = table_mask.shape
    hull_mask = np.zeros((h, w), np.uint8)
    cv2.drawContours(hull_mask, [hull], -1, 255, thickness=cv2.FILLED)
    shell = cv2.subtract(hull_mask,
        cv2.erode(hull_mask,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (SHELL_WIDTH, SHELL_WIDTH))))
    on_shell = shell[cnt[:, 1].clip(0, h - 1),
                     cnt[:, 0].clip(0, w - 1)] > 0
    edge_pts = cnt[on_shell]
    if len(edge_pts) < 50:
        edge_pts = cnt

    # 5) 按方向角把采样点分四组
    cx, cy = hull.mean(axis=0)
    ang = np.arctan2(edge_pts[:, 1] - cy, edge_pts[:, 0] - cx)
    top    = edge_pts[(ang > -3*np.pi/4) & (ang < -np.pi/4)]
    right  = edge_pts[(ang >= -np.pi/4)  & (ang <= np.pi/4)]
    bottom = edge_pts[(ang >  np.pi/4)   & (ang <  3*np.pi/4)]
    left   = edge_pts[(ang >= 3*np.pi/4) | (ang <= -3*np.pi/4)]

    if debug:
        return {"top": top, "right": right, "bottom": bottom, "left": left,
                "mask": mask, "table_mask": table_mask}
    return None


def draw(img, dbg=None):
    vis = img.copy()
    if dbg:
        cols = {"top": (255, 128, 0), "right": (0, 200, 255),
                "bottom": (255, 0, 255), "left": (0, 255, 128)}
        for name in ["top", "right", "bottom", "left"]:
            if name in dbg:
                pts = dbg[name]
                for p in pts:
                    cv2.circle(vis, tuple(int(v) for v in p), 2, cols[name], -1)
    return vis


if __name__ == "__main__":
    img = cv2.imread("image2.png")
    dbg = detect_snooker_table(img, debug=True)
    if dbg:
        print("Top points:", len(dbg["top"]))
        print("Right points:", len(dbg["right"]))
        print("Bottom points:", len(dbg["bottom"]))
        print("Left points:", len(dbg["left"]))
        cv2.imwrite("result2.png", draw(img, dbg))