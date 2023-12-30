let rawFile;
let hiddenFile;
let imageWidth;
let imageHeight;
const maxCanvasWidth = 800;
const minCanvasWidth = 100;
let originalImageData;
let secondImageData;
let currentImageData;
let scaleFactor = 1.0;
let minScaleFactor = 1.0;
let maxScaleFactor = 20.0;
let dragStart = [];
let mouseCoord = [0, 0];
let locked = false;
let panelButton = '';
let channel = 0;
let bitPlaneChannel = 0;
let bitPlane = 0;
let grayScale;
let combine = false;
let combineMode = -1;
let exif = false;
let content = null;
let contentType;
let barcodeData = '';
let lsbData = '';
let framesData = null;
let frameNo = 0;
let canvas;
let ctx;
const instruction = 'Scroll to zoom. Drag to move. Click to lock.';

//reset upload
window.onload = () => {
	document.getElementById('file').value = '';
	document.getElementById('url').value = '';
	document.getElementById('contentSave').addEventListener('click', function() {saveFile(content, contentType);});
	canvas = document.getElementById('image');
	ctx = canvas.getContext('2d');
}

function hexToAscii(s) {
	let res = '';
	for (let i = 0; i < s.length; i += 2)
		res += String.fromCharCode(parseInt(s.substr(i, 2), 16));
	return res;
}

//from image coordinate to canvas coordinate
function transformPoint(x, y) {
	const pt = new DOMPoint(x, y).matrixTransform(ctx.getTransform());
	return [Math.floor(pt.x), Math.floor(pt.y)];
}

//from canvas coordinate to image coordinate
function inversePoint(x, y) {
	const pt = new DOMPoint(x, y).matrixTransform(ctx.getTransform().inverse());
	x = Math.floor(pt.x);
	y = Math.floor(pt.y);
	x = x < 0 ? 0 : x >= imageWidth ? imageWidth - 1 : x;
	y = y < 0 ? 0 : y >= imageHeight ? imageHeight - 1 : y;
	return [x, y];
}

function enterURL(event) {
	if (event.key == "Enter") {
		event.preventDefault();
		upload();
  }
}

//upload new image from file/URL, or the second image for combining two images
async function upload(){
	if (document.getElementById('url').value == '' && document.getElementById('file').value == '')
		return;
	let message = document.getElementById('msg');
	let uploadFile;
	message.innerText = 'Loading...';
	if (document.getElementById('url').value != '') {
		if (!document.getElementById('url').checkValidity()) {
			message.innerText = 'Invalid URL!';
			return;
		}
		//use backend to avoid CORS error
		let data = new FormData();
		data.append('url', document.getElementById('url').value);
		const response = await fetch('download.php', {
			method: 'POST',
			body: data
		});
		if (!response.ok) {
			message.innerText = 'URL not found!';
			return;
		}
		const fileType = response.headers.get('content-type');
		data = await response.blob();
		uploadFile = new File([data], 'source', {type: fileType});
	} else
		uploadFile = document.getElementById('file').files[0];
	//size limit 10MB
	if (uploadFile.size > 10000000) {
		message.innerText = 'Too large file size!';
		return;
	}
	let img = new Image();
	img.onload = function() {
		if (combine) {
			//upload the second image for combining
			if (imageWidth != this.width || imageHeight != this.height) {
				message.innerText = 'Not matching image size!';
				return;
			}
			let fakeCanvas = document.createElement('canvas');
			let fakeCtx = fakeCanvas.getContext('2d');
			fakeCanvas.width = imageWidth;
			fakeCanvas.height = imageHeight;
			fakeCtx.drawImage(this, 0, 0);
			secondImageData = fakeCtx.getImageData(0, 0, this.width, this.height);
			message.innerText = instruction;
			if (combineMode == -1) combineMode = 0;
			combineImages(0);
		} else {
			imageWidth = this.width;
			imageHeight = this.height;
			let fakeCanvas = document.createElement('canvas');
			let fakeCtx = fakeCanvas.getContext('2d');
			fakeCanvas.width = imageWidth;
			fakeCanvas.height = imageHeight;
			fakeCtx.drawImage(this, 0, 0);
			currentImageData = fakeCtx.getImageData(0, 0, imageWidth, imageHeight);
			//calclate range of scale factor
			scaleFactor = 1.0;
			if (imageWidth > maxCanvasWidth)
				scaleFactor = maxCanvasWidth / imageWidth;
			else if (imageWidth < minCanvasWidth)
				scaleFactor = minCanvasWidth / imageWidth;
			canvas.width = Math.floor(imageWidth * scaleFactor);
			canvas.height = Math.floor(imageHeight * scaleFactor);
			ctx.webkitImageSmoothingEnabled = false;
			ctx.mozImageSmoothingEnabled = false;
			ctx.imageSmoothingEnabled = false;
			minScaleFactor = scaleFactor;
			maxScaleFactor = minScaleFactor > 20.0 ? minScaleFactor: 20.0;
			ctx.scale(scaleFactor, scaleFactor);
			rawFile = uploadFile;
			exif = false;
			content = null;
			framesData = null;
			frameNo = 0;
			document.getElementById('imageArea').style.display = 'block';
			document.getElementById('coords').style.display = 'block';
			document.getElementById('operations').style.display = 'block';
			work();
			message.innerText = instruction;
		}
	};
	img.onerror = function() {
		message.innerText = 'Invalid image file!';
	}
	img.src = URL.createObjectURL(uploadFile);
}

//move the image when dragging, or update/lock the coordinates
function canvasDown(event) {
	dragStart = [event.offsetX, event.offsetY];
	canvas.style.cursor = 'grab';
}

function canvasMove(event) {
	if (dragStart.length > 0) {
		let shiftX = event.offsetX - mouseCoord[0];
		let shiftY = event.offsetY - mouseCoord[1];
		mouseCoord = [event.offsetX, event.offsetY];
		const topLeft = transformPoint(0, 0);
		const bottomRight = transformPoint(imageWidth, imageHeight);
		if (topLeft[0] + shiftX > 0 || bottomRight[0] + shiftX < canvas.width)
			shiftX = 0;
		if (topLeft[1] + shiftY > 0 || bottomRight[1] + shiftY < canvas.height)
			shiftY = 0;
		ctx.translate(shiftX / scaleFactor, shiftY / scaleFactor);
		draw(currentImageData);
	} else {
		mouseCoord = [event.offsetX, event.offsetY];
		updateCoords();
	}
}

function canvasUp() {
	if (dragStart.length == 0)
		return;
	if (dragStart[0] === mouseCoord[0] && dragStart[1] === mouseCoord[1])
		lock();
	dragStart = [];
	canvas.style.cursor = 'crosshair';
}

//adjust scale factor and position when scrolling
function zoom(event) {
	event.preventDefault();
	const sensitivity = 0.01;
	newScaleFactor = scaleFactor - event.deltaY * sensitivity;
	if (newScaleFactor < minScaleFactor)
		newScaleFactor = minScaleFactor;
	else if (newScaleFactor > maxScaleFactor)
		newScaleFactor = maxScaleFactor;
	const targetPoint = inversePoint(mouseCoord[0], mouseCoord[1]);
	ctx.translate(targetPoint[0], targetPoint[1]);
	ctx.scale(newScaleFactor / scaleFactor, newScaleFactor / scaleFactor);
	ctx.translate(-targetPoint[0], -targetPoint[1]);
	scaleFactor = newScaleFactor;
	//move to avoid blank space in canvas
	const topLeft = transformPoint(0, 0);
	const bottomRight = transformPoint(imageWidth, imageHeight);
	let correction = [0, 0];
	if (topLeft[0] > 0)
		correction[0] = -topLeft[0];
	else if (bottomRight[0] < canvas.width)
		correction[0] = canvas.width - bottomRight[0];
	if (topLeft[1] > 0)
		correction[1] = -topLeft[1];
	else if (bottomRight[1] < canvas.height)
		correction[1] = canvas.height - bottomRight[1];
	ctx.translate(correction[0] / scaleFactor, correction[1] / scaleFactor);
	draw(currentImageData);
}

//update coordinates and color values
function updateCoords(){
	if (locked) return;
	const coord = inversePoint(mouseCoord[0], mouseCoord[1]);
	document.getElementById('x').innerText = coord[0];
	document.getElementById('y').innerText = coord[1];
	let pixel = [];
	for (let i = 0; i < 4; i++)
		pixel.push(currentImageData.data[4 * (coord[1] * imageWidth + coord[0]) + i]);
	document.getElementById('r').innerText = pixel[0];
	document.getElementById('g').innerText = pixel[1];
	document.getElementById('b').innerText = pixel[2];
	document.getElementById('a').innerText = pixel[3];
	let colorhex = '';
	const channelCount = (document.getElementById('alphaContainer').style.display == 'inline') ? 4 : 3;
	for (let i = 0; i < channelCount; i++){
		hex = pixel[i].toString(16);
		if (hex.length == 1)
			hex = '0' + hex;
		colorhex = colorhex + hex;
	}
	document.getElementById('rgbColor').innerText = colorhex;
}

//lock coordinates and color values
function lock(event){
	if (locked){
		locked = false;
		document.getElementById('lock').innerText = '';
		updateCoords();
	} else {
		locked = true;
		document.getElementById('lock').innerHTML = '&nbsp;(Locked)';
	}
}

//show different panels for different functions
function showPanel(name){
	if (panelButton != name) {
		if (combine && name != 'combinePanel') switchCombine(false);
		if (panelButton != '')
			document.getElementById(panelButton).style.display = 'none';
		panelButton = name;
		document.getElementById(panelButton).style.display = 'block';
		document.getElementById('msg').innerText = instruction;
	}
}

//reset canvas to the original image
function resetImage(){
	if (combine) switchCombine(false);
	if (panelButton != '') {
		document.getElementById(panelButton).style.display = 'none';
		panelButton = '';
		document.getElementById('msg').innerText = instruction;
	}
	currentImageData = structuredClone(originalImageData);
	draw(originalImageData);
}

//use canvas image as the original image
function work(){
	originalImageData = structuredClone(currentImageData);
	if (hasAlphaChannel(originalImageData))
		document.getElementById('alphaContainer').style.display = 'inline';
	else
		document.getElementById('alphaContainer').style.display = 'none';
	combineMode = -1;
	barcodeData = '';
	lsbData = '';
	grayScale = [];
	resetImage();
}

//draw image data according to the translation and scaling
function draw(imageData) {
	const topLeft = transformPoint(0, 0);
	const bottomRight = transformPoint(imageWidth, imageHeight);
	ctx.clearRect(-1, -1, imageWidth + 1, imageHeight + 1);
	let fakeCanvas = document.createElement('canvas');
	let fakeCtx = fakeCanvas.getContext('2d');
	fakeCanvas.width = imageWidth;
	fakeCanvas.height = imageHeight;
	fakeCtx.putImageData(imageData, 0, 0);
	ctx.drawImage(fakeCanvas, 0, 0);
}

//inverse all colors (x -> 255 - x)
function inverse(){
	if (panelButton != 'inverse') {
		if (combine) switchCombine(false);
		if (panelButton != '')
			document.getElementById(panelButton).style.display = 'none';
		panelButton = 'inverse';
		document.getElementById('msg').innerText = instruction;
		document.getElementById(panelButton).style.display = 'inline';
		currentImageData = structuredClone(originalImageData);
		let pixels = currentImageData.data;
		for (let i = 0; i < pixels.length; i++) {
			if (i % 4 != 3)
				pixels[i] = 255 - pixels[i];
		}
		draw(currentImageData);
	}
}

//Google Lens image search
function googleLens(){
	let fakeCanvas = document.createElement('canvas');
	fakeCanvas.width = canvas.width;
	fakeCanvas.height = canvas.height;
	let fakeCtx = fakeCanvas.getContext('2d');
	fakeCtx.putImageData(originalImageData, 0, 0);
	fakeCanvas.toBlob((blob) => {
		const searchFile = new File([blob], "image.png", {type: "image/png"});
		let container = new DataTransfer(); 
		container.items.add(searchFile);
		document.getElementById('googleFile').files = container.files;
		document.getElementById('googleSearch').submit();
	});
}

//Yandex image search
function yandex(){
	document.getElementById('msg').innerText = 'Loading...';
	let fakeCanvas = document.createElement('canvas');
	fakeCanvas.width = imageWidth;
	fakeCanvas.height = imageHeight;
	let fakeCtx = fakeCanvas.getContext('2d');
	fakeCtx.putImageData(originalImageData, 0, 0);
	fakeCanvas.toBlob((blob) => {
		const searchFile = new File([blob], "image.jpg", {type: "image/jpeg"});
		let formData = new FormData();
		formData.append('image[]', searchFile);
		fetch('yandex.php', {
			method: 'POST',
			body: formData
		})
		.then((response) => response.text())
		.then((data) => {
			document.getElementById('yandexSearch').href = data;
			document.getElementById('yandexSearch').click();
			document.getElementById('msg').innerText = instruction;
		});
	}, 'image/jpeg');
}

//view RGB(A) channels
function changeChannel(step){
	if (step == 0) showPanel('channelPanel');
	const channelCount = (document.getElementById('alphaContainer').style.display == 'inline') ? 4 : 3;
    const channelName = ['Red', 'Green', 'Blue'].concat(channelCount === 4 ? ['Alpha'] : []);
	channel = (channel + step + channelCount) % channelCount;
	document.getElementById('channel').innerText = channelName[channel];
	currentImageData = structuredClone(originalImageData);
	let pixels = currentImageData.data;
	for (let i = 0; i < pixels.length; i++) {
		const remainder = i % 4;
		if (remainder == 3)
			pixels[i] = 255;
		else if (channel == 3)
			pixels[i] = pixels[i + 3 - remainder];
		else if (remainder != channel)
			pixels[i] = 0;
	}
	draw(currentImageData);
}

//check if there is any non-255 alpha value
function hasAlphaChannel(imageData) {
	let pixels = imageData.data;
	for (let i = 3; i < pixels.length; i += 4) {
		if (pixels[i] !== 255) {
			return true;
		}
	}
	return false;
}

//view RGB(A) bit planes
function changeBitPlane(channelStep, planeStep){
	if (channelStep === 0 && planeStep === 0) showPanel('bitPlanePanel');

    currentImageData = structuredClone(originalImageData);
    const channelCount = (document.getElementById('alphaContainer').style.display == 'inline') ? 5 : 4;
    const channelName = ['Red', 'Green', 'Blue', 'RGB'].concat(channelCount === 5 ? ['Alpha'] : []);
    
    bitPlaneChannel = (bitPlaneChannel + channelStep + channelCount) % channelCount;
    bitPlane = (bitPlane + planeStep + 8) % 8;

    document.getElementById('bitPlaneChannel').innerText = channelName[bitPlaneChannel];
    document.getElementById('bitPlane').innerText = bitPlane.toString();
	
	let pixels = currentImageData.data;
	for (let i = 0; i < pixels.length; i += 4) {
        let bitValue;
        
        if (bitPlaneChannel < 3) {
            bitValue = (pixels[i + bitPlaneChannel] >> bitPlane) & 1;
        }

        for (let j = 0; j < 3; j++) {
            if (bitPlaneChannel === 3) {
                bitValue = (pixels[i + j] >> bitPlane) & 1;
            } else if (bitPlaneChannel === 4) {
                bitValue = (pixels[i + 3] >> bitPlane) & 1;
            }
            pixels[i + j] = bitValue ? 255 : 0;
        }

        if (bitPlaneChannel === 4) {
            pixels[i + 3] = 255;
        }
    }
	draw(currentImageData);
}

//adjust threshold value
function threshold() {
	let pixels;
	showPanel('thresholdPanel');
	//precompute gray scale image
	if (grayScale.length == 0) {
		pixels = originalImageData.data;
		for (let i = 0; i < pixels.length; i += 4)
			grayScale.push(Math.floor(0.299 * pixels[i] + 0.587 * pixels[i+1] + 0.114 * pixels[i+2]));
	}
	thresholdValue = parseInt(document.getElementById('thresholdSlider').value);
	currentImageData = structuredClone(originalImageData);
	pixels = currentImageData.data;
	for (let i = 0; i < grayScale.length; i++) {
		if (grayScale[i] >= thresholdValue) {
			for (let j = 0; j < 3; j++)
				pixels[4 * i + j] = 255;
		} else {
			for (let j = 0; j < 3; j++)
				pixels[4 * i + j] = 0;
		}
	}
	draw(currentImageData);
	document.getElementById('thresholdValue').innerText = thresholdValue.toString();
}

//adjust brightness using gamma correction
function brightness() {
	showPanel('brightnessPanel');
	brightnessValue = parseInt(document.getElementById('brightnessSlider').value);
	gamma = Math.pow(10, -brightnessValue / 100);
	currentImageData = structuredClone(originalImageData);
	let pixels = currentImageData.data;
	for (let i = 0; i < pixels.length; i++) {
		if (i % 4 != 3)
			pixels[i] = Math.round(255 * Math.pow(pixels[i] / 255, gamma));
	}
	draw(currentImageData);
	document.getElementById('brightnessValue').innerText = brightnessValue.toString();
}

//switch on/off function for combining two images
function switchCombine(turn) {
	if (turn) {
		if (combineMode == -1) resetImage();
		else combineImages(0);
		combine = true;
		document.getElementById('msg').innerText = 'Use the above to upload the second image.';
	} else {
		combine = false;
		document.getElementById('msg').innerText = instruction;
	}
}

//combine two images with different blending modes
function combineImages(step) {
	if (step == 0) showPanel('combinePanel');
	const modeName = ['XOR', 'OR', 'AND', 'ADD', 'MIN', 'MAX'];
	combineMode = (combineMode + step + 6) % 6;
	document.getElementById('combineMode').innerText = modeName[combineMode];
	currentImageData = structuredClone(originalImageData);
	let pixels1 = currentImageData.data;
	let pixels2 = secondImageData.data;
	for (let i = 0; i < pixels1.length; i++){
		if (i % 4 == 3) continue;
		let value;
		switch (combineMode) {
			case 0:
				value = pixels1[i] ^ pixels2[i];
				break;
			case 1:
				value = pixels1[i] | pixels2[i];
				break;
			case 2:
				value = pixels1[i] & pixels2[i];
				break;
			case 3:
				value = pixels1[i] + pixels2[i];
				if (value > 255) value = 255;
				break;
			case 4:
				value = Math.min(pixels1[i], pixels2[i]);
				break;
			case 5:
				value = Math.max(pixels1[i], pixels2[i]);
				break;
		}
		pixels1[i] = value;
	}
	draw(currentImageData);
}

//view content after the end of image
function hiddenContent() {
	if (content != null) {
		showPanel('contentPanel');
		return;
	}
	const reader = new FileReader();
	reader.onload = () => {
		const rawData = reader.result;
		//detect PNG/JPG from file header
		if (rawData.substr(0, 8) != hexToAscii('89504e470d0a1a0a') && rawData.substr(0, 2) != hexToAscii('ffd8')) {
			document.getElementById('msg').innerText = 'This function only supports PNG and JPG!';
			return;
		}
		//traverse till the end of image
		let start;
		if (rawData.substr(0, 8) == hexToAscii('89504e470d0a1a0a')) 
			start = rawData.indexOf(hexToAscii('0000000049454e44ae426082')) + 12;
		else {
			//skip incorrect FFD9 using header sizes
			start = 0;
			while (rawData[start + 1] != hexToAscii('d9')) {
				let marker = rawData.charCodeAt(start + 1).toString(16);
				if (marker == '0' || marker == '1' || marker == 'ff' || (marker.length == 2 && marker[0] == 'd'))
					start += 1;
				else
					start += rawData.charCodeAt(start + 2) * 256 + rawData.charCodeAt(start + 3) + 2;
				start = rawData.indexOf(hexToAscii('ff'), start);
			}
			start += 2;
		}
		content = rawData.substr(start);
		document.getElementById('content').innerText = content;
		//detect common file format
		if (content.substr(0, 3) == 'BZh')
			contentType = 'bz2';
		else if (content.substr(0, 6) == 'GIF87a' || content.substr(0, 6) == 'GIF89a')
			contentType = 'gif';
		else if (content.substr(0, 4) == hexToAscii('49492a00') || content.substr(0, 4) == hexToAscii('4d4d002a'))
			contentType = 'tiff';
		else if (content.substr(0, 2) == hexToAscii('ffd8'))
			contentType = 'jpg';
		else if (content.substr(0, 4) == hexToAscii('504b0304') || content.substr(0, 4) == hexToAscii('504b0506') || content.substr(0, 4) == hexToAscii('504b0708'))
			contentType = 'zip';
		else if (content.substr(0, 6) == hexToAscii('526172211a07'))
			contentType = 'rar';
		else if (content.substr(0, 4) == 'RIFF' && content.substr(8, 4) == 'WAVE')
			contentType = 'wav';
		else if (content.substr(0, 3) == 'ID3')
			contentType = 'mp3';
		else if (content.substr(0, 2) == 'BM')
			contentType = 'bmp';
		else if (content.substr(0, 4) == 'MThd')
			contentType = 'mid';
		else if (content.substr(0, 6) == hexToAscii('377abcaf271c'))
			contentType = '7z';
		else if (content.substr(0, 8) == 'ftypisom')
			contentType = 'mp4';
		else
			contentType = 'txt';
		let typeText = document.getElementById('contentType');
		if (contentType == 'txt') {
			typeText.innerText = 'Content';
			typeText.classList.remove('data');
		} else {
			typeText.innerText = contentType.toUpperCase();
			typeText.classList.add('data');
		}
		showPanel('contentPanel');
	};
	reader.readAsBinaryString(rawFile);
}

//save text/binary string for various functions
function saveFile(fileContent, fileExtension) {
	let fileArray = new Uint8Array(fileContent.length);
	for (let i = 0; i < fileContent.length; i++)
		fileArray[i] = fileContent.charCodeAt(i);
	const blob = new Blob([fileArray]);
	const save = document.getElementById('fileSave');
	save.href = URL.createObjectURL(blob);
	save.download = 'hidden.' + fileExtension;
	save.click();
}

//save canvas image as png
function saveImage() {
	const save = document.getElementById('fileSave');
	let fakeCanvas = document.createElement('canvas');
	let fakeCtx = fakeCanvas.getContext('2d');
	fakeCanvas.width = imageWidth;
	fakeCanvas.height = imageHeight;
	fakeCtx.putImageData(currentImageData, 0, 0);
	save.href = fakeCanvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
	save.download = 'edited.png';
	save.click();
}

//view or hide the full EXIF table
function fullExif(){
	if (document.getElementById('fullExif').innerText == 'View full EXIF') {
		document.getElementById('exifTable').style.display = 'block';
		document.getElementById('fullExif').innerText = 'Hide full EXIF';
	} else {
		document.getElementById('exifTable').style.display = 'none';
		document.getElementById('fullExif').innerText = 'View full EXIF';
	}
}

//view EXIF
function viewExif() {
	if (exif) {
		showPanel('exifPanel');
		return;
	}
	document.getElementById('msg').innerText = 'Loading...';
	let formData = new FormData();
	formData.append('image[]', rawFile);
	fetch('exif.php', {
		method: 'POST',
		body: formData
	})
	.then((response) => response.json())
	.then((data) => {
		//a selection of commonly used EXIF tags
		const selection = ['FileType', 'ImageWidth', 'ImageHeight', 'ImageDescription', 'ModifyDate',
			'Artist', 'Copyright', 'DateTimeOriginal', 'CreateDate', 'UserComment', 'OwnerName',
			'GPSLatitudeRef', 'GPSLatitude', 'GPSLongitudeRef', 'GPSLongitude', 'ObjectName',
			'Keywords', 'Headline', 'Caption-Abstract', 'Location', 'Creator', 'Description',
			'Title', 'Label', 'Rating', 'Comment', 'GPSPosition', 'ThumbnailImage', 'XPAuthor',
			'XPComment', 'XPKeywords', 'XPSubject', 'XPTitle'];
		const exifData = Object.entries(data);
		let potentialTable = document.getElementById('potentialTable');
		let fullTable = document.getElementById('exifTable');
		potentialTable.innerHTML = '';
		fullTable.innerHTML = '';
		let row = potentialTable.insertRow(-1);
		let header = document.createElement('th');
		header.colSpan = 2;
		header.innerText = 'Potentially useful data';
		row.appendChild(header);
		exifData.forEach((group) => {
			row = fullTable.insertRow(-1);
			let header = document.createElement('th');
			header.colSpan = 2;
			header.innerText = group[0];
			row.appendChild(header);
			Object.entries(group[1]).forEach((entry) => {
				row = fullTable.insertRow(-1);
				tag = row.insertCell(0);
				tag.innerText = entry[0];
				tag.classList.add('exifItem');
				value = row.insertCell(1);
				//display thumbnail image
				if (entry[0] == 'ThumbnailImage') {
					let imageArray = new Uint8Array(entry[1].length);
					for (let i = 0; i < entry[1].length; i++)
						imageArray[i] = entry[1].charCodeAt(i);
					const blob = new Blob([imageArray]);
					let img = document.createElement('img');
					img.src = URL.createObjectURL(blob);
					value.appendChild(img);
				}
				else if (/^[\u0020-\u007e]*$/.test(entry[1]))
					value.innerText = entry[1];
				else {
					//create link for non-printable ASCII content
					const blob = new Blob([entry[1]], {type:"text/plain;charset=UTF-8"});
					let a = document.createElement('a');
					a.target = '_blank';
					a.href = URL.createObjectURL(blob);
					a.innerText = 'See here';
					value.appendChild(a);
				}
				value.classList.add('exifData');
				if (selection.includes(entry[0]))
					potentialTable.insertRow(-1).innerHTML = row.innerHTML;
			});
		});
		exif = true;
		showPanel('exifPanel');
	});
}

//initialize the GIF frame viewer
function initFrame() {
	if (rawFile.type != 'image/gif') {
		document.getElementById('msg').innerText = 'This function only supports GIF!';
		return;
	}
	if (framesData == null) {
		document.getElementById('msg').innerText = 'Loading...';
		let img = document.getElementById('gifImage');
		img.src = URL.createObjectURL(rawFile);
		framesData = new SuperGif({gif: img});
		framesData.load(function() {
			viewFrame(0);
			framesData.pause();
			showPanel('framePanel');
		});
	} else {
		viewFrame(0);
		showPanel('framePanel');
	}
}

//view GIF frames one by one
function viewFrame(step) {
	const gifLength = framesData.get_length();
	frameNo = (frameNo + step + gifLength) % gifLength;
	framesData.move_to(frameNo);
	let fakeCanvas = framesData.get_canvas();
	let fakeCtx = fakeCanvas.getContext('2d');
	currentImageData = fakeCtx.getImageData(0, 0, fakeCanvas.width, fakeCanvas.height);
	draw(currentImageData);
	const frameNoDisplay = frameNo + 1;
	document.getElementById('frameNo').innerText = frameNoDisplay.toString();
}

//initialize LSB panel
function initLSB() {
	showPanel('lsbPanel');
	document.getElementById('lsbPreview').innerText = lsbData;
}

//extract LSB data
function extractLSB() {
	lsbData = '';
	const rgbMap = {'r': 0, 'g': 1, 'b': 2};
	let checked = [];
	for (let i = 0; i < 3; i++) {
		const color = document.getElementById('bitPlaneOrder').value[i];
		let colorChecked = [];
		for (let j = 0; j < 8; j++) {
			let digit;
			if (document.getElementById('bitOrder').value == 'lsb')
				digit = j;
			else
				digit = 7 - j;
			if (document.getElementById(color + digit.toString()).checked)
				colorChecked.push(digit);
		}
		checked.push([rgbMap[color], colorChecked]);
	}
	const pixels = originalImageData.data;
	let binary = 0;
	let count = 7;
	let start = 0;
	for (let i = 0; i < pixels.length / 4; i++) {
		for (let j = 0; j < 3; j++){
			const bits = pixels[start + checked[j][0]];
			for (let k = 0; k < checked[j][1].length; k++) {
				binary += ((bits >> checked[j][1][k]) & 1) << count;
				count -= 1;
				if (count < 0) {
					lsbData += String.fromCharCode(binary);
					binary = 0;
					count = 7;
				}
			}
		}
		if (document.getElementById('pixelOrder').value == 'row')
			start += 4;
		else {
			start = start + 4 * canvas.width;
			if (start >= pixels.length)
				start = start - pixels.length + 4;
		}
	}
	document.getElementById('lsbPreview').innerText = lsbData;
}

function initAdvanced() {
	resetImage();
	showPanel('advancedPanel');
}

function advancedHelp() {
	alert('Enter JavaScript expressions to manipulate pixel values in custom ways.\n' +
	'The results are rounded off to integers between 0 and 255.\n' +
	'Lock the color picker to execute on one color only.\n' +
	'Allowed characters: r, g, b, 0-9, .+-*/%()=<>!&|^?:');
}

//scripting for color values
function executeExpressions() {
	const rgb = ['r', 'g', 'b'];
	let ex = [];
	//check for allowed formulas
	for (let i = 0; i < 3; i++) {
		ex.push(document.getElementById(rgb[i] + 'Expression').value);
		if (ex[i] === '') ex[i] = rgb[i];
		if (!/^[0-9rgb.+\-*\/%()=<>!&|^?: ]*$/.test(ex[i])) {
			document.getElementById('msg').innerText = 'Invalid expressions!';
			return;
		}
	}
	const backupImageData = structuredClone(currentImageData);
	try {
		let fn = [];
		let color = [];
		const coord = parseInt(document.getElementById('y').innerText) * imageWidth + 
			parseInt(document.getElementById('x').innerText);
		let pixels = currentImageData.data;
		//create JS functions from formulas
		for (let i = 0; i < 3; i++) {
			fn.push(Function('r', 'g', 'b', 'return ' + ex[i]));
			color.push(pixels[4 * coord + i]);
		}
		//compute formulas and cap
		for (let i = 0; i < pixels.length; i += 4) {
			if (locked && (pixels[i] !== color[0] || pixels[i+1] !== color[1] || pixels[i+2] !== color[2]))
				continue;
			let pxval = [];
			for (let j = 0; j < 3; j++) {
				let val = Math.round(fn[j](pixels[i], pixels[i+1], pixels[i+2]));
				val = val < 0 ? 0 : val > 255 ? 255 : val;
				pxval.push(val);
			}
			for (let j = 0; j < 3; j++)
				pixels[i+j] = pxval[j];
		}
		draw(currentImageData);
		for (let i = 0; i < 3; i++)
			document.getElementById(rgb[i]).innerText = pixels[4 * coord + i].toString();
		let colorhex = '';
		const channelCount = (document.getElementById('alphaContainer').style.display == 'inline') ? 4 : 3;
		for (let i = 0; i < channelCount; i++){
			hex = pixels[4 * coord + i].toString(16);
			if (hex.length == 1)
				hex = '0' + hex;
			colorhex = colorhex + hex;
		}
		document.getElementById('rgbColor').innerText = colorhex;
		document.getElementById('msg').innerText = instruction;
	} catch {
		document.getElementById('msg').innerText = 'Invalid expressions!';
		currentImageData = structuredClone(backupImageData);
		draw(currentImageData);
	}
}

function initBarcode() {
	showPanel('barcodePanel');
	document.getElementById('barcodeContent').innerText = barcodeData;
}

//scan common barcodes
function barcode() {
	document.getElementById('msg').innerText = 'Loading...';
	const barcodeReader = new Html5Qrcode('barcodeReader');
	let fakeCanvas = document.createElement('canvas');
	fakeCanvas.width = imageWidth;
	fakeCanvas.height = imageHeight;
	let fakeCtx = fakeCanvas.getContext('2d');
	fakeCtx.putImageData(originalImageData, 0, 0);
	fakeCanvas.toBlob((blob) => {
		const barcodeFile = new File([blob], "image.png", {type: "image/png"});
		barcodeReader.scanFile(barcodeFile, true)
		.then(decoded => {
			barcodeData = decoded;
			document.getElementById('barcodeContent').innerText = barcodeData;
			document.getElementById('msg').innerText = instruction;
		})
		.catch(err => {
			barcodeData = '';
			document.getElementById('barcodeContent').innerText = 'Error ' + err;
			document.getElementById('msg').innerText = instruction;
		});
	});
}