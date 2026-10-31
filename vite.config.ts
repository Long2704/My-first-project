import {defineConfig} from 'vite';

export default defineConfig({
 build:{
  rollupOptions:{
   output:{
    manualChunks(id){
     // Keep stable library bytes in one content-hashed file between UI releases.
     if(id.includes('/node_modules/'))return 'vendor';
    }
   }
  }
 }
});
