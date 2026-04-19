#!/usr/bin/env python3
"""验证 Phase 4 系统正常工作"""

import sys
sys.path.insert(0, '/Users/zs.yuan/Documents/Project/snooker/pocket')

print("=" * 60)
print("🧪 Phase 4 验证测试")
print("=" * 60)

# Test 1: Import pocket module
print("\n✅ Test 1: Import pocket module")
try:
    from pocket import make_all_pockets, check_potted, Pocket
    print("   ✓ pocket module imported successfully")
except Exception as e:
    print(f"   ✗ Error: {e}")
    sys.exit(1)

# Test 2: Generate pocket geometries
print("\n✅ Test 2: Generate pocket geometries")
try:
    pockets = make_all_pockets(tightness=0.5)
    print(f"   ✓ Created {len(pockets)} pockets")
    for p in pockets:
        print(f"      {p.name:3s}: center={p.center}, capture_r={p.capture_radius:.4f}")
except Exception as e:
    print(f"   ✗ Error: {e}")
    sys.exit(1)

# Test 3: Test potted detection
print("\n✅ Test 3: Test potted detection")
try:
    import numpy as np
    tr_pocket = pockets[0]
    test_pos_inside = tr_pocket.center.copy()
    test_pos_outside = tr_pocket.center + np.array([1.0, 1.0])
    
    result_inside = check_potted(test_pos_inside, pockets)
    result_outside = check_potted(test_pos_outside, pockets)
    
    if result_inside and result_inside.name == tr_pocket.name:
        print(f"   ✓ Ball at pocket center correctly detected as potted")
    else:
        print(f"   ✗ Ball at pocket center NOT detected")
    
    if result_outside is None:
        print(f"   ✓ Ball outside pocket correctly NOT detected")
    else:
        print(f"   ✗ Ball outside pocket incorrectly detected")
except Exception as e:
    print(f"   ✗ Error: {e}")

# Test 4: API test
print("\n✅ Test 4: API test")
try:
    import requests
    API_URL = 'http://localhost:9000/simulate'
    payload = {
        'a': 0,
        'b': 0,
        'phi': 0,
        'theta': 0,
        'force': 0.5,
        'mu_tip': 0.4,
        'enable_collision': True,
        'pocket_tightness': 0.5
    }
    
    response = requests.post(API_URL, json=payload, timeout=5)
    data = response.json()
    
    if data['success']:
        print(f"   ✓ API request successful")
        print(f"      - Frames: {len(data['frames'])}")
        print(f"      - pocket_tightness in response: {data.get('pocket_tightness', 'NOT FOUND')}")
    else:
        print(f"   ✗ API request failed: {data.get('error')}")
except Exception as e:
    print(f"   ✗ Error: {e}")

print("\n" + "=" * 60)
print("✅ Phase 4 验证完成")
print("=" * 60)
