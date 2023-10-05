onmessage = (event) => {
    let count = 0;
    for (let i = 0; i < 999999999; i++) {
        count += 1;
    }
    postMessage('finished');
};
export {};
