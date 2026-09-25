import {test,expect} from '@playwright/test'
import * as THREE from 'three'
import {normalizeAssetScene} from '../src/asset-normalization.js'

test('normalization removes translation but preserves nested mirrored dimensions',()=>{
  const source=new THREE.Group()
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,1,.5))
  mesh.position.set(3,4,5);mesh.scale.x=-1
  source.add(mesh);source.position.set(10,20,30)
  const {scene,dimensions}=normalizeAssetScene(source,{w:2,h:1,d:.5})
  expect(dimensions).toEqual({w:2,h:1,d:.5})
  const bounds=new THREE.Box3().setFromObject(scene,true)
  expect(bounds.min.toArray()).toEqual([-1,0,-.25])
  expect(bounds.max.toArray()).toEqual([1,1,.25])
  expect(mesh.scale.x).toBe(-1)
})

test('wrong source units or missing geometry fail instead of being scaled to fit',()=>{
  expect(()=>normalizeAssetScene(new THREE.Mesh(new THREE.BoxGeometry(20,10,5)),{w:2,h:1,d:.5})).toThrow(/尺寸/)
  expect(()=>normalizeAssetScene(new THREE.Group(),{w:2,h:1,d:.5})).toThrow(/网格/)
})

test('unused indexed vertices do not inflate the physical footprint',()=>{
  const geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,2,0,0,0,1,1,999,999,999],3))
  geometry.setIndex([0,1,2])
  const {dimensions}=normalizeAssetScene(new THREE.Mesh(geometry),{w:2,h:1,d:1})
  expect(dimensions).toEqual({w:2,h:1,d:1})
})
