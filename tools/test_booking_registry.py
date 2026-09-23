"""Exercise the offline registry gate using a disposable copy, never live files."""
import copy,json,pathlib,subprocess,sys,tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
record=json.loads((ROOT/'data/viator-links.json').read_text(encoding='utf-8'))['links'][0]
adventure=next(a for a in json.loads((ROOT/'data/adventures.json').read_text(encoding='utf-8')) if a['id']==record['adventure_id'])
with tempfile.TemporaryDirectory(prefix='wayfinder-booking-registry-') as temp:
 root=pathlib.Path(temp);(root/'tools').mkdir();(root/'data').mkdir()
 (root/'tools/build_booking_links.py').write_bytes((ROOT/'tools/build_booking_links.py').read_bytes())
 (root/'data/adventures.json').write_text(json.dumps([adventure]),encoding='utf-8')
 def check(change,ok):
  row=copy.deepcopy(record);row.update(change)
  (root/'data/viator-links.json').write_text(json.dumps(dict(schema_version=1,links=[row])),encoding='utf-8')
  result=subprocess.run([sys.executable,str(root/'tools/build_booking_links.py'),'--write'],capture_output=True)
  assert (result.returncode==0)==ok,change
 check({},True)
 check({'product_status':'INACTIVE'},False)
 check({'schedule_status':'no_current_or_future_schedule'},False)
 check({'verification':'search_result'},False)
 check({'product_status_evidence':'https://api.viator.com/partner/products/other'},False)
 check({'product_status_checked_at':'2099-01-01T00:00:00+00:00'},False)
 check({'verification':'product_api','evidence_url':'https://api.viator.com/partner/products/'+record['product_code']},True)
 check({'affiliate_url':record['affiliate_url']+'&account=private'},False)
 check({'affiliate_url':record['affiliate_url'].replace('pid=P00321485','pid=P99999999')},False)
print('9 booking-registry checks passed: ACTIVE product, current/future schedule, dated evidence and intact affiliate URL required')
