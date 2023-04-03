const text = "浩渺行无极，扬帆但信风"; // 要打印的文本
const typingSpeed = 50; // 打字速度，单位毫秒
const deletingSpeed = 20; // 删除速度，单位毫秒
const pauseTime = 1000; // 打完一遍后的暂停时间，单位毫秒

let index = 0; // 当前打印到的字符索引
let isDeleting = false; // 是否正在删除
let delay = typingSpeed; // 打印和删除的间隔时间

function type() {
  const typingText = document.getElementById("typing-text");

  // 如果正在删除，减少速度以增加删除效果
  if (isDeleting) {
    delay = deletingSpeed;
    typingText.textContent = text.substring(0, index--) + "_";
  } else {
    typingText.textContent = text.substring(0, index++) + "_";
  }

  // 切换打印和删除状态
  if (index === text.length + 1) {
    isDeleting = true;
    delay = pauseTime;
  } else if (index === 0) {
    isDeleting = false;
    delay = typingSpeed;
  }

  // 循环调用函数
  setTimeout(type, delay);
}

// 开始打印
type();
