// Original small geometric C mark, authored as pixels for Windows ICO packaging.
import fs from 'node:fs/promises';
const size=64;
const image=Buffer.alloc(40+size*size*4+size*size/8);
image.writeUInt32LE(40,0);image.writeInt32LE(size,4);image.writeInt32LE(size*2,8);
image.writeUInt16LE(1,12);image.writeUInt16LE(32,14);image.writeUInt32LE(size*size*4,20);
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const edge=Math.min(x,y,size-1-x,size-1-y);
  const ink=(x>=17&&x<25&&y>=16&&y<48)||(x>=25&&x<47&&((y>=16&&y<24)||(y>=40&&y<48)));
  const color=ink?[241,248,240]:[35,101,83];
  const index=40+((size-1-y)*size+x)*4;
  image[index]=color[2];image[index+1]=color[1];image[index+2]=color[0];image[index+3]=edge<2?0:255;
}
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);
header[6]=size;header[7]=size;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(image.length,14);header.writeUInt32LE(22,18);
await fs.mkdir('resources',{recursive:true});await fs.writeFile('resources/clientdeck.ico',Buffer.concat([header,image]));
