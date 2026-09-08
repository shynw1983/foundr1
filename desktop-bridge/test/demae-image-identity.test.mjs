import test from 'node:test';
import assert from 'node:assert/strict';
import {sameDemaeImage} from '../src/demae-menu-client.mjs';

const image = {itemImageUri:'https://cdn.demae-can.com/files/imgix/item720/store/item.jpg?v=1',itemImageFileName:'item.jpg',imageTrimmingRange:null};
test('Demae CDN cache version may change on a non-image save',()=>{
  assert.equal(sameDemaeImage(image,{...image,itemImageUri:image.itemImageUri.replace('v=1','v=2')}),true);
});
test('real image identity, other transforms and cropping changes fail verification',()=>{
  for(const changed of [
    {itemImageUri:image.itemImageUri.replace('item.jpg','other.jpg')},
    {itemImageUri:image.itemImageUri+'&width=10'},
    {itemImageFileName:'other.jpg'},
    {imageTrimmingRange:{x:1}},
    {itemImageUri:null}
  ])assert.equal(sameDemaeImage(image,{...image,...changed}),false);
  const unknown={...image,itemImageUri:'https://example.com/item.jpg?v=1'};
  assert.equal(sameDemaeImage(unknown,{...unknown,itemImageUri:'https://example.com/item.jpg?v=2'}),false);
});
